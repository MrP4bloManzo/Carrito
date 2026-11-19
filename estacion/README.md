# Estacion Wi-Fi, MQTT y LoRa

Implementacion local basada en dloza18/Estacion_Geoespacial, revision b019ff5.
Flujo: navegador -> API Node.js -> MQTT Mosquitto -> gateway ESP32 Wi-Fi -> LoRa -> carrito.
Las confirmaciones CACK y telemetria regresan por MQTT; el servidor registra la telemetria aunque no haya navegadores abiertos.

## Arranque

Requiere Node.js 22+, MongoDB local o Atlas y acceso a Internet.
1. Ejecutar npm install en esta carpeta.
2. Copiar .env.example como .env, ajustar MONGO_URI y ADMIN_PASSWORD.
3. Ejecutar npm start y abrir http://localhost:8080.
El administrador se crea solo la primera vez. Las cuentas registradas desde la pagina tienen rol user.
El rol efectivo lo decide el servidor. El servidor debe exponerse mediante HTTPS si se accede remotamente.

## Gateway

Abrir firmware/Gateway_WiFi/Gateway_WiFi.ino en Arduino IDE.
Completar WIFI_SSID y WIFI_PASSWORD en config.h.
Bibliotecas: PubSubClient, ArduinoJson 7, LoRa (Sandeep Mistry), Adafruit SSD1306 y Adafruit GFX.
Placa ESP32 Dev Module. Se conservan NSS27, SCK18, MISO19, MOSI23, RST14, DIO026 y OLED21/22.
Mosquitto de pruebas: test.mosquitto.org:1883.
El reloj del ESP32 debe sincronizarse por NTP antes de aceptar comandos MQTT.
La pagina envia movimientos de 500 ms. S y E locales conservan el protocolo previo.
No se emplea SIM800L.

## Contrato

Topicos: carrito/gateway01/command, carrito/gateway01/ack y carrito/gateway01/telemetry.
MQTT command: id, command, speed entero 0..100, duration entero 0..5000, expires Unix en segundos.
FORWARD/BACKWARD/LEFT/RIGHT requieren duration>=100. STOP, ESTOP y STATUS son especiales.
El gateway asigna SEQ y traduce a CMD|SRC=GATEWAY_01|DST=CARRITO_01|SEQ=...|MOVE=...|SPEED=...|DUR=...|ESTOP=...
El carrito debe implementar limite de duracion local y CACK con SRC, DST, SEQ, STATUS.
Telemetria almacenada: TEL|SRC=CARRITO_01|SEQ=...|TEMP=...|PRESS=...|LAT=...|LNG=...|ALT=...|STATE=...
Presion en hPa, temperatura en Celsius y coordenadas en grados decimales.
Si tu carrito usa nombres diferentes, deben mapearse en server/server.js y web/app.js.
El comando publicado no implica ejecucion: revisar SENT, CACK, TIMEOUT o TX_ERROR.

## Validacion y pendientes

Comprobacion de sintaxis Node.js realizada en app.js y server/server.js.
Aun pendientes: instalacion de dependencias, prueba con MongoDB, compilacion ESP32 y ensayo extremo a extremo.
No se ha publicado esta version en GitHub ni cargado firmware.
Mosquitto de pruebas es compartido y sin autenticacion; los roles de la API no impiden publicaciones externas directas al broker.
El navegador usa HTTP hacia la API; MQTT se ejecuta en el servidor, no directamente mediante WebSocket en esta version.
La rubrica solicita WebSocket MQTT, navegacion automatica, hardware celular y alimentacion solar: esos apartados no quedan completados con esta entrega.
Waypoints y faros/buzzer requieren especificar y adaptar el firmware del carrito. Los controles correspondientes informan que no estan soportados.
La gestion CRUD admite crear, consultar, eliminar y PATCH en API; la interfaz de edicion individual aun requiere completarse.
CSV: encabezados time/temp/press/lat/lng o Timestamp/Temperature/Pressure/Latitude/Longitude; valores numericos sin comas internas.
