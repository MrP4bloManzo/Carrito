# Gateway LoRa del carrito — ESP32

Este firmware corresponde al **gateway**: la estación que recibe comandos por USB/Monitor Serie, los transmite al carrito por LoRa y muestra la telemetría en una OLED. Se carga en el ESP32 del gateway.

## Hardware y conexiones

- ESP32 Dev Module.
- Radio SX1278 RA-02 de 433 MHz.
- OLED SSD1306 I2C de 128 × 64, dirección `0x3C`.

| Señal | GPIO del ESP32 |
|---|---|
| LoRa SCK | 18 |
| LoRa MISO | 19 |
| LoRa MOSI | 23 |
| LoRa NSS | 27 |
| LoRa RST | 14 |
| LoRa DIO0 | 26 |
| OLED SDA | 21 |
| OLED SCL | 22 |

## Abrir en Arduino IDE

Abrir [Gateway_Carrito.ino](Gateway_Carrito.ino) y seleccionar **ESP32 Dev Module**. Requiere el paquete ESP32 de Espressif y las bibliotecas **LoRa de Sandeep Mistry**, **Adafruit GFX Library** y **Adafruit SSD1306**.

Monitor Serie: **115200 baudios**, con **Nueva línea**.

| Comando | Acción |
|---|---|
| `F 60 1500` | Avanzar al 60 % durante 1500 ms |
| `B 60 1500` | Retroceder |
| `L 50 800` | Girar a la izquierda |
| `R 50 800` | Girar a la derecha |
| `S` | Solicitar detención |
| `E` | Enviar parada de emergencia |
| `T` | Solicitar estado |
| `HELP` | Mostrar ayuda |

Acepta mayúsculas y minúsculas. Velocidad: 0–100 %. Duración: 100–5000 ms. Los movimientos sin parámetros conservan los valores predeterminados indicados en la ayuda; también puede omitirse solo la duración. Los parámetros inválidos se rechazan.

## Comunicación

- Gateway: `GATEWAY_01`; carrito: `CARRITO_01`.
- Radio: 433 MHz, SF7, BW125 kHz, CR4/5, preámbulo de 8 símbolos, Sync Word `0x12`, CRC activado.
- Telemetría del carrito: `TEL`; respuesta del gateway: `ACK`.
- Comandos del gateway: `CMD`; confirmación del carrito: `CACK`.

El gateway comprueba origen, destino y secuencia de las confirmaciones. Una transmisión local finalizada queda **esperando CACK**; si no llega en **8 segundos**, se informa **SIN CONFIRMACION**. Mientras espera, rechaza nuevos movimientos o consultas; `S` y `E` pueden sustituir el comando pendiente. No retransmite movimientos automáticamente.

La parada también depende de la recepción y ejecución en el carrito. El firmware del carrito debe implementar el protocolo y los límites de movimiento.

## Validación

Esta versión compiló correctamente en Arduino IDE para **ESP32 Dev Module**: 339156 bytes de programa (25 %) y 23868 bytes de variables globales (7 %). La comunicación física con el carrito queda pendiente de validar; los paquetes ilegibles observados requieren comparar ambos extremos.

El sketch no incluye SIM800L.
