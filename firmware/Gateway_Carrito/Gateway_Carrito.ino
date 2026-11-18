/*
  PROYECTO: GATEWAY PARA CARRITO
  Hardware: ESP32 + SX1278 RA-02 433 MHz + OLED SSD1306 I2C
  LoRa: Sandeep Mistry
  OLED: Adafruit SSD1306 + Adafruit GFX

  Pines LoRa (configuracion probada por el usuario):
    SCK=18, MISO=19, MOSI=23, NSS=27, RST=14, DIO0=26
  OLED: SDA=21, SCL=22, direccion 0x3C

  Protocolo:
    Carrito -> Gateway: TEL|SRC=CARRITO_01|SEQ=n|...
    Gateway -> Carrito: ACK|SRC=GATEWAY_01|DST=CARRITO_01|SEQ=n
    Gateway -> Carrito: CMD|SRC=GATEWAY_01|DST=CARRITO_01|SEQ=n|MOVE=...|SPEED=...|DUR=...|ESTOP=...
    Carrito -> Gateway: CACK|SRC=CARRITO_01|DST=GATEWAY_01|SEQ=n|STATUS=...|MOVE=...

  Comandos en Monitor Serial (115200 baudios):
    F 60 1500  = adelante 60% durante 1500 ms
    B 60 1500  = atras
    L 50 800   = izquierda
    R 50 800   = derecha
    S          = detener
    E          = parada de emergencia
    T          = solicitar estado
    HELP       = mostrar ayuda

  Nota: no incluye SIM800L. Se integra despues.
*/

#include <Arduino.h>
#include <ctype.h>
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// -------------------- Identidad --------------------
static const char *GATEWAY_ID = "GATEWAY_01";
static const char *CART_ID = "CARRITO_01";

// -------------------- Pines LoRa --------------------
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_SS    27  // NSS confirmado en GPIO27
#define LORA_RST   14
#define LORA_DIO0  26

// -------------------- Radio --------------------
#define LORA_FREQ       433E6
#define LORA_SF         7
#define LORA_BW         125E3
#define LORA_CR         5
#define LORA_SYNC_WORD  0x12
#define LORA_TX_POWER   17
#define MAX_PACKET_LEN  240

// -------------------- OLED --------------------
#define OLED_SDA   21
#define OLED_SCL   22
#define OLED_ADDR  0x3C
#define OLED_W     128
#define OLED_H     64
Adafruit_SSD1306 display(OLED_W, OLED_H, &Wire, -1);
bool oledOK = false;

// -------------------- Temporizadores --------------------
const unsigned long OLED_INTERVAL_MS = 400;
const unsigned long LINK_TIMEOUT_MS = 16000; // telemetria cada 5 s
unsigned long lastOledUpdate = 0;
unsigned long lastCartRx = 0;
const unsigned long COMMAND_ACK_TIMEOUT_MS = 8000; // 5 s de movimiento mas margen de radio
bool cartSeen = false;
bool commandPending = false;
uint32_t pendingCommandSeq = 0;
unsigned long commandSentAt = 0;

// -------------------- Contadores --------------------
uint32_t commandSeq = 0;
uint32_t telemetryCount = 0;
uint32_t commandCount = 0;
uint32_t cackCount = 0;
uint32_t txErrors = 0;

// -------------------- Estado recibido --------------------
int lastRssi = 0;
float lastSnr = 0;
String lastBattery = "NA";
String lastCartState = "SIN DATOS";
String lastMessage = "INICIANDO";
String lastCommandStatus = "NINGUNO";
bool linkOnline = false;

// Solo acepta campos completos y no duplicados.
String getField(const String &message, const String &key) {
  String token = key + "=";
  String result;
  bool found = false;
  int start = 0;
  while (start < (int)message.length()) {
    int end = message.indexOf('|', start);
    if (end < 0) end = message.length();
    String field = message.substring(start, end);
    if (field.startsWith(token)) {
      if (found) return ""; // Campo ambiguo: rechazar.
      result = field.substring(token.length());
      found = true;
    }
    start = end + 1;
  }
  return result;
}

// Decimal sin signo, sin texto sobrante ni desbordamiento.
bool parseUnsigned(const String &text, uint32_t &value) {
  if (text.length() == 0) return false;
  uint32_t result = 0;
  for (unsigned int i = 0; i < text.length(); ++i) {
    char c = text.charAt(i);
    if (c < '0' || c > '9') return false;
    uint32_t digit = c - '0';
    if (result > (UINT32_MAX - digit) / 10U) return false;
    result = result * 10U + digit;
  }
  value = result;
  return true;
}

void updateLinkAndCommandTimeout() {
  unsigned long now = millis();
  linkOnline = cartSeen && (now - lastCartRx <= LINK_TIMEOUT_MS);
  if (commandPending && now - commandSentAt >= COMMAND_ACK_TIMEOUT_MS) {
    commandPending = false;
    lastCommandStatus = "SIN CONFIRMACION";
    lastMessage = "CACK TIMEOUT";
    Serial.print("SIN CONFIRMACION DEL CARRITO para SEQ=");
    Serial.println(pendingCommandSeq);
    // No repetir movimientos automaticamente: podria ejecutarlos dos veces.
  }
}

bool sendRadio(const String &packet) {
  if (packet.length() == 0 || packet.length() > MAX_PACKET_LEN) {
    Serial.println("ERROR TX: paquete vacio o demasiado grande");
    txErrors++;
    LoRa.receive();
    return false;
  }

  LoRa.idle();
  if (LoRa.beginPacket() != 1 || LoRa.print(packet) != packet.length()) {
    txErrors++;
    LoRa.receive();
    return false;
  }
  int result = LoRa.endPacket();
  LoRa.receive();

  if (result == 1) return true;
  txErrors++;
  return false;
}

void sendTelemetryACK(uint32_t receivedSeq) {
  String ack = "ACK|SRC=" + String(GATEWAY_ID) +
               "|DST=" + String(CART_ID) +
               "|SEQ=" + String(receivedSeq);
  Serial.print("TX ACK: ");
  Serial.println(ack);
  if (!sendRadio(ack)) Serial.println("ERROR enviando ACK");
}

void sendCommand(const String &move, int speedPct, unsigned long durationMs, bool emergency) {
  // STOP y emergencia pueden sustituir cualquier comando pendiente.
  if (commandPending && move != "STOP") {
    Serial.println("Hay un comando pendiente. Espera CACK o usa S/E para detener.");
    return;
  }
  commandPending = false;
  if (speedPct < 0) speedPct = 0;
  if (speedPct > 100) speedPct = 100;

  // Los movimientos tienen duracion limitada para evitar movimiento indefinido.
  if (move == "FORWARD" || move == "BACKWARD" || move == "LEFT" || move == "RIGHT") {
    if (durationMs < 100) durationMs = 100;
    if (durationMs > 5000) durationMs = 5000;
  } else {
    durationMs = 0;
  }

  commandSeq++;
  if (commandSeq == 0) commandSeq = 1;
  String packet = "CMD|SRC=" + String(GATEWAY_ID) +
                  "|DST=" + String(CART_ID) +
                  "|SEQ=" + String(commandSeq) +
                  "|MOVE=" + move +
                  "|SPEED=" + String(speedPct) +
                  "|DUR=" + String(durationMs) +
                  "|ESTOP=" + String(emergency ? 1 : 0);

  Serial.println();
  Serial.println("========== ENVIANDO COMANDO ==========");
  Serial.println(packet);
  if (sendRadio(packet)) {
    commandCount++;
    pendingCommandSeq = commandSeq;
    commandSentAt = millis();
    commandPending = true;
    lastCommandStatus = "ESPERANDO CACK";
    Serial.println("TX CMD: OK local; esperando confirmacion CACK del carrito");
  } else {
    lastCommandStatus = "ERROR TX";
    Serial.println("TX CMD: ERROR");
  }
  Serial.println("======================================");
}

void printHelp() {
  Serial.println();
  Serial.println("COMANDOS DEL GATEWAY:");
  Serial.println("  F 60 1500  -> avanzar 60% por 1500 ms");
  Serial.println("  B 60 1500  -> retroceder");
  Serial.println("  L 50 800   -> girar izquierda");
  Serial.println("  R 50 800   -> girar derecha");
  Serial.println("  S          -> detener");
  Serial.println("  E          -> PARADA DE EMERGENCIA");
  Serial.println("  T          -> solicitar estado");
  Serial.println("  HELP       -> ayuda");
  Serial.println();
}

void processSerialLine(String line) {
  line.trim();
  if (line.length() == 0) return;
  if (line.equalsIgnoreCase("HELP")) {
    printHelp();
    return;
  }

  String tokens[4];
  int count = 0;
  unsigned int pos = 0;
  while (pos < line.length()) {
    while (pos < line.length() && isspace((unsigned char)line.charAt(pos))) ++pos;
    if (pos >= line.length()) break;
    if (count == 4) {
      Serial.println("ERROR: demasiados parametros. Escribe HELP.");
      return;
    }
    unsigned int start = pos;
    while (pos < line.length() && !isspace((unsigned char)line.charAt(pos))) ++pos;
    tokens[count++] = line.substring(start, pos);
  }

  if (count == 0 || tokens[0].length() != 1) {
    Serial.println("Comando no reconocido. Escribe HELP.");
    return;
  }
  char op = toupper((unsigned char)tokens[0].charAt(0));
  bool movement = op == 'F' || op == 'B' || op == 'L' || op == 'R';
  if (!movement) {
    if (count != 1) {
      Serial.println("ERROR: S, E y T no aceptan parametros.");
      return;
    }
    switch (op) {
      case 'S': sendCommand("STOP", 0, 0, false); break;
      case 'E': sendCommand("STOP", 0, 0, true); break;
      case 'T': sendCommand("STATUS", 0, 0, false); break;
      default: Serial.println("Comando no reconocido. Escribe HELP."); break;
    }
    return;
  }

  uint32_t speed = (op == 'L' || op == 'R') ? 50 : 60;
  uint32_t duration = (op == 'L' || op == 'R') ? 800 : 1500;
  if (count > 3 ||
      (count >= 2 && !parseUnsigned(tokens[1], speed)) ||
      (count >= 3 && !parseUnsigned(tokens[2], duration)) ||
      speed > 100 || duration < 100 || duration > 5000) {
    Serial.println("ERROR: velocidad 0..100 y duracion 100..5000 ms, solo enteros.");
    return;
  }
  const char *move = op == 'F' ? "FORWARD" : op == 'B' ? "BACKWARD" :
                     op == 'L' ? "LEFT" : "RIGHT";
  sendCommand(move, (int)speed, duration, false);
}

void handleSerial() {
  // Acumula hasta fin de linea sin bloquear la recepcion LoRa.
  static String line;
  static bool discardLine = false;
  unsigned int budget = 96;
  while (budget-- > 0 && Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (!discardLine) processSerialLine(line);
      line = "";
      discardLine = false;
    } else if (!discardLine) {
      if (line.length() >= 80 || (c != '\t' && (c < 32 || c > 126))) {
        line = "";
        discardLine = true;
        Serial.println("ERROR: linea demasiado larga o con caracteres invalidos.");
      } else {
        line += c;
      }
    }
  }
}

void processReceivedPacket(const String &packet) {
  lastRssi = LoRa.packetRssi();
  lastSnr = LoRa.packetSnr();
  String source = getField(packet, "SRC");
  String destination = getField(packet, "DST");
  if (source != CART_ID || (destination.length() > 0 && destination != GATEWAY_ID)) {
    Serial.println("Paquete ignorado: origen o destino incorrecto.");
    return;
  }

  Serial.println();
  Serial.println("========== PAQUETE RECIBIDO ==========");
  Serial.print("PAYLOAD: "); Serial.println(packet);
  Serial.print("RSSI: "); Serial.print(lastRssi); Serial.println(" dBm");
  Serial.print("SNR: "); Serial.print(lastSnr, 1); Serial.println(" dB");

  if (packet.startsWith("TEL|")) {
    if (source != CART_ID) {
      Serial.println("TEL de un origen distinto; no se confirma como CARRITO_01");
      Serial.println("======================================");
      return;
    }
    uint32_t seq;
    if (!parseUnsigned(getField(packet, "SEQ"), seq)) {
      Serial.println("TEL rechazada: SEQ ausente, duplicado o invalido.");
      return;
    }
    lastCartRx = millis();
    cartSeen = true;
    linkOnline = true;
    telemetryCount++;
    lastBattery = getField(packet, "BAT");
    lastCartState = getField(packet, "STATE");
    if (lastCartState.length() == 0) lastCartState = "SIN ESTADO";
    lastMessage = "TEL SEQ " + getField(packet, "SEQ");
    sendTelemetryACK(seq);
  }
  else if (packet.startsWith("CACK|")) {
    uint32_t seq;
    String status = getField(packet, "STATUS");
    if (destination != GATEWAY_ID || !parseUnsigned(getField(packet, "SEQ"), seq) ||
        !commandPending || seq != pendingCommandSeq || status.length() == 0 ||
        millis() - commandSentAt >= COMMAND_ACK_TIMEOUT_MS) {
      Serial.println("CACK ignorado: destino, secuencia, estado o plazo no valido.");
      return;
    }
    commandPending = false;
    if (source == CART_ID) {
      lastCartRx = millis();
      cartSeen = true;
      linkOnline = true;
      cackCount++;
      lastCommandStatus = getField(packet, "STATUS");
      lastMessage = "CACK " + getField(packet, "SEQ");
      Serial.print("CONFIRMACION DEL CARRITO: ");
      Serial.println(lastCommandStatus);
    }
  }
  else if (packet.startsWith("PONG|")) {
    if (source == CART_ID) {
      lastCartRx = millis();
      cartSeen = true;
      linkOnline = true;
      lastMessage = "PONG RECIBIDO";
    }
  }
  else if (packet.startsWith("ALERT|")) {
    if (source == CART_ID) {
      lastCartRx = millis();
      cartSeen = true;
      linkOnline = true;
      lastMessage = "ALERTA DEL CARRITO";
      Serial.println("*** ALERTA RECIBIDA DEL CARRITO ***");
    }
  }
  else {
    Serial.println("Tipo de paquete no reconocido por el Gateway.");
  }

  Serial.println("======================================");
}

void receiveLoRa() {
  int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) return;

  String packet;
  packet.reserve(MAX_PACKET_LEN);
  bool valid = packetSize <= MAX_PACKET_LEN;
  while (LoRa.available()) {
    char c = (char)LoRa.read();
    if (c < 32 || c > 126) valid = false;
    if (packet.length() < MAX_PACKET_LEN) packet += c;
  }
  if (valid && packet.length() == (unsigned int)packetSize) {
    processReceivedPacket(packet);
  } else {
    Serial.println("RX descartado: longitud o texto incompatible con el protocolo.");
  }
  LoRa.receive();
}

void updateOLED() {
  if (!oledOK) return;


  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println("GATEWAY - CARRITO");
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  display.setCursor(0, 14);
  display.print("LINK: ");
  display.println(linkOnline ? "ONLINE" : "OFFLINE");

  display.setCursor(0, 25);
  display.print("TEL RX: "); display.print(telemetryCount);
  display.print(" CMD TX:"); display.println(commandCount);

  display.setCursor(0, 36);
  display.print("BAT: "); display.print(lastBattery);
  display.print(" RSSI:"); display.println(lastRssi);

  display.setCursor(0, 47);
  display.print("STATE: "); display.println(lastCartState.substring(0, 16));

  display.setCursor(0, 58);
  display.print(lastMessage.substring(0, 21));

  display.display();
}

bool initializeLoRa() {
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQ)) return false;

  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setPreambleLength(8);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();
  LoRa.receive();
  return true;
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(25);
  delay(400);

  Serial.println();
  Serial.println("====================================");
  Serial.println(" GATEWAY PARA CARRITO - ESP32 LORA");
  Serial.println("====================================");

  Wire.begin(OLED_SDA, OLED_SCL);
  oledOK = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (oledOK) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("GATEWAY CARRITO");
    display.println("Iniciando LoRa...");
    display.display();
    Serial.println("OLED: OK");
  } else {
    Serial.println("OLED: no detectada (revisa 0x3C/0x3D)");
  }

  if (!initializeLoRa()) {
    Serial.println("ERROR: SX1278 no detectado. Revisa NSS=GPIO27 y cableado.");
    lastMessage = "LORA ERROR";
    while (true) {
      if (oledOK) {
        display.clearDisplay(); display.setTextSize(1);
        display.setCursor(0, 0); display.println("GATEWAY ERROR");
        display.println("SX1278 no detectado"); display.display();
      }
      delay(1000);
    }
  }

  Serial.println("LoRa: OK | 433 MHz | SF7 | BW125 | CR4/5 | SW=0x12");
  Serial.println("Gateway listo. Escribe HELP para ver comandos.");
  printHelp();
  lastMessage = "ESPERANDO CARRITO";
}

void loop() {
  receiveLoRa();
  updateLinkAndCommandTimeout();
  handleSerial();

  if (millis() - lastOledUpdate >= OLED_INTERVAL_MS) {
    lastOledUpdate = millis();
    updateOLED();
  }
}
