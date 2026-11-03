# ESP32 + GPS NEO-6M + OLED + Sensor A0/D0

Proyecto integrado para ESP32 DevKit V1. Combina la lectura de un GPS NEO-6M, una pantalla OLED SSD1306 I2C y un sensor con salidas analógica (A0) y digital (D0).

## Funciones

- Lectura del GPS NEO-6M mediante UART2 a 9600 baudios.
- Visualización de latitud, longitud, satélites, altitud, velocidad y estado de FIX.
- Lectura analógica del sensor en GPIO34 y lectura digital en GPIO27.
- Visualización de las mediciones en OLED SSD1306 de 128 x 64.
- Diagnóstico de todos los datos por Monitor Serie a 115200 baudios.
- Temporización con `millis()`; el programa no utiliza `delay()`.

## Componentes

- ESP32 DevKit V1.
- GPS NEO-6M.
- OLED SSD1306 I2C 128 x 64 (dirección habitual 0x3C).
- Sensor con salidas A0 y D0.
- Cables y alimentación adecuada.

## Conexiones

| Componente | Pin del módulo | ESP32 |
|---|---|---|
| OLED SSD1306 | SDA | GPIO21 |
| OLED SSD1306 | SCL | GPIO22 |
| OLED SSD1306 | VCC | 3.3 V (según módulo) |
| OLED SSD1306 | GND | GND |
| GPS NEO-6M | TX | GPIO16 (RX2) |
| GPS NEO-6M | RX | GPIO17 (TX2) |
| GPS NEO-6M | VCC | Según especificación del módulo |
| GPS NEO-6M | GND | GND |
| Sensor | A0 | GPIO34 |
| Sensor | D0 | GPIO27 |
| Sensor | VCC | Según especificación del módulo |
| Sensor | GND | GND |

**Importante:** compartir GND entre los módulos. Los GPIO del ESP32 no son tolerantes a 5 V; verifica que A0 y D0 no entreguen más de 3.3 V. Si el GPS requiere una alimentación distinta, respeta las especificaciones de la placa del módulo.

## Librerías de Arduino IDE

Instalar desde el Library Manager:

1. Adafruit GFX Library
2. Adafruit SSD1306
3. TinyGPSPlus

También se requiere el paquete de placas ESP32 de Espressif.

## Instalación y prueba

1. Abrir `firmware/ESP32_GPS_OLED_Sensor/ESP32_GPS_OLED_Sensor.ino` en Arduino IDE.
2. Seleccionar la placa ESP32 Dev Module (o el modelo equivalente de tu DevKit).
3. Seleccionar el puerto COM correspondiente.
4. Compilar y cargar.
5. Abrir el Monitor Serie a **115200 baudios**.
6. Probar el GPS en un espacio abierto con buena visibilidad del cielo. La primera posición puede tardar.

## Organización

```text
Carrito/
├── README.md
├── .gitignore
└── firmware/
    └── ESP32_GPS_OLED_Sensor/
        └── ESP32_GPS_OLED_Sensor.ino
```

## Notas

- Si la OLED no inicia, verificar la dirección I2C (0x3C o 0x3D), el cableado y la alimentación.
- Si no hay FIX GPS, el resto del sistema sigue funcionando; la pantalla indicará que está buscando posición.
- La lectura digital D0 depende del umbral ajustado en el potenciómetro del módulo sensor.
- El valor de voltaje se obtiene con `analogReadMilliVolts()` y es una referencia de la lectura ADC del ESP32.

## Estado de validación

El código se preparó integrando los dos sketches proporcionados. La compilación y el funcionamiento físico deben validarse en el montaje real.
