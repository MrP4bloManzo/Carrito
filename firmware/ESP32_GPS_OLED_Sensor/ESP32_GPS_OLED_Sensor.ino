#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <TinyGPSPlus.h>

// ==================================================
// ESP32 DevKit V1 + GPS NEO-6M + OLED SSD1306
// + sensor analogico/digital (A0/D0)
// ==================================================

// OLED SSD1306
#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_WIDTH 128
#define OLED_HEIGHT 64
#define OLED_ADDR 0x3C
#define OLED_RESET -1

Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);

// GPS NEO-6M conectado a UART2
#define GPS_RX 16  // ESP32 RX2 <- TX del GPS
#define GPS_TX 17  // ESP32 TX2 -> RX del GPS
#define GPS_BAUD 9600

TinyGPSPlus gps;

// Sensor analogico/digital
#define PIN_A0 34
#define PIN_D0 27

// Temporizadores no bloqueantes
const unsigned long INTERVALO_OLED = 500;
const unsigned long INTERVALO_SENSOR = 500;
const unsigned long INTERVALO_SERIAL = 1000;

unsigned long ultimaActualizacionOLED = 0;
unsigned long ultimaLecturaSensor = 0;
unsigned long ultimoDiagnostico = 0;

int valorAnalogico = 0;
int voltaje_mV = 0;
int valorDigital = LOW;
bool oledOK = false;

void leerSensor();
void mostrarDatosOLED();
void mostrarDatosSerial();

void setup() {
  Serial.begin(115200);

  pinMode(PIN_D0, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_A0, ADC_11db);

  Wire.begin(OLED_SDA, OLED_SCL);

  if (oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    oledOK = true;
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(1);
    oled.setCursor(0, 0);
    oled.println("SISTEMA INTEGRADO");
    oled.println();
    oled.println("Iniciando GPS...");
    oled.println("Iniciando sensor...");
    oled.display();
  } else {
    Serial.println("ERROR: OLED no detectada en 0x3C.");
  }

  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX, GPS_TX);

  Serial.println();
  Serial.println("========================================");
  Serial.println(" ESP32 + GPS NEO-6M + SENSOR + OLED");
  Serial.println("========================================");
  Serial.println("OLED I2C: SDA GPIO21 / SCL GPIO22");
  Serial.println("GPS UART2: RX GPIO16 / TX GPIO17");
  Serial.println("Sensor: A0 GPIO34 / D0 GPIO27");
  Serial.println("Monitor serie: 115200 baudios");
  Serial.println("----------------------------------------");
}

void loop() {
  // Procesa continuamente la UART para no perder sentencias NMEA.
  while (Serial2.available() > 0) {
    gps.encode(Serial2.read());
  }

  const unsigned long ahora = millis();

  if (ahora - ultimaLecturaSensor >= INTERVALO_SENSOR) {
    ultimaLecturaSensor = ahora;
    leerSensor();
  }

  if (ahora - ultimaActualizacionOLED >= INTERVALO_OLED) {
    ultimaActualizacionOLED = ahora;
    mostrarDatosOLED();
  }

  if (ahora - ultimoDiagnostico >= INTERVALO_SERIAL) {
    ultimoDiagnostico = ahora;
    mostrarDatosSerial();
  }
}

void leerSensor() {
  valorAnalogico = analogRead(PIN_A0);
  voltaje_mV = analogReadMilliVolts(PIN_A0);
  valorDigital = digitalRead(PIN_D0);
}

void mostrarDatosOLED() {
  if (!oledOK) return;

  const bool posicionReciente =
      gps.location.isValid() && gps.location.age() < 3000;

  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);

  oled.setCursor(0, 0);
  oled.println("GPS NEO-6M + SENSOR");

  oled.setCursor(0, 8);
  oled.print("Sat: ");
  if (gps.satellites.isValid()) oled.print(gps.satellites.value());
  else oled.print("--");
  oled.print("  FIX: ");
  oled.println(posicionReciente ? "SI" : "NO");

  oled.setCursor(0, 16);
  oled.print("Lat: ");
  if (posicionReciente) oled.println(gps.location.lat(), 5);
  else oled.println("Buscando...");

  oled.setCursor(0, 24);
  oled.print("Lon: ");
  if (posicionReciente) oled.println(gps.location.lng(), 5);
  else oled.println("Buscando...");

  oled.setCursor(0, 32);
  oled.print("Alt: ");
  if (gps.altitude.isValid()) {
    oled.print(gps.altitude.meters(), 1);
    oled.println(" m");
  } else oled.println("-- m");

  oled.setCursor(0, 40);
  oled.print("Vel: ");
  if (gps.speed.isValid()) {
    oled.print(gps.speed.kmph(), 1);
    oled.println(" km/h");
  } else oled.println("-- km/h");

  oled.setCursor(0, 48);
  oled.print("A0: ");
  oled.print(valorAnalogico);
  oled.print(" ");
  oled.print(voltaje_mV / 1000.0f, 2);
  oled.println("V");

  oled.setCursor(0, 56);
  oled.print("D0: ");
  oled.println(valorDigital == HIGH ? "HIGH (1)" : "LOW (0)");

  oled.display();
}

void mostrarDatosSerial() {
  Serial.println();
  Serial.println("========== DATOS DEL SISTEMA ==========");

  Serial.println("[SENSOR ANALOGICO / DIGITAL]");
  Serial.print("A0: ");
  Serial.println(valorAnalogico);
  Serial.print("Voltaje: ");
  Serial.print(voltaje_mV);
  Serial.println(" mV");
  Serial.print("D0: ");
  Serial.println(valorDigital == HIGH ? "HIGH (1)" : "LOW (0)");

  Serial.println("---------------------------------------");
  Serial.println("[GPS NEO-6M]");
  Serial.print("Caracteres recibidos: ");
  Serial.println(gps.charsProcessed());

  Serial.print("Satelites: ");
  if (gps.satellites.isValid()) Serial.println(gps.satellites.value());
  else Serial.println("Sin informacion");

  if (gps.location.isValid() && gps.location.age() < 3000) {
    Serial.println("Estado GPS: POSICION VALIDA");
    Serial.print("Latitud: ");
    Serial.println(gps.location.lat(), 6);
    Serial.print("Longitud: ");
    Serial.println(gps.location.lng(), 6);
  } else {
    Serial.println("Estado GPS: BUSCANDO POSICION");
  }

  Serial.print("Altitud: ");
  if (gps.altitude.isValid()) {
    Serial.print(gps.altitude.meters(), 2);
    Serial.println(" m");
  } else Serial.println("Sin informacion");

  Serial.print("Velocidad: ");
  if (gps.speed.isValid()) {
    Serial.print(gps.speed.kmph(), 2);
    Serial.println(" km/h");
  } else Serial.println("Sin informacion");

  Serial.println("=======================================");
}
