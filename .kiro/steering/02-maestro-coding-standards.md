---

inclusion: always

---

 

# Estándares de Codificación Maestro (POM & Multiplataforma Nativo Swift/Kotlin)

 

## 1. Estrategia de Selectores para Apps Nativas (Swift + Kotlin)

Al trabajar con aplicaciones nativas puras, el agente debe interpretar correctamente cómo Maestro mapea las propiedades de cada SDK al ejecutar `inspect_screen`:

 

- **Prioridad 1 — Identificador Único (`id`):**

  - En **Kotlin (Android XML / Jetpack Compose)** corresponde al `resource-id` o `testTag`. Maestro suele incluir el prefijo del paquete en Android (ej. `com.app.paquete:id/btn_login`). Usa expresiones regulares o coincidencia parcial si el prefijo varía entre entornos (ej. `id: ".*btn_login"`), o asegúrate de usar el ID limpio si es Compose.

  - En **Swift (UIKit / SwiftUI)** corresponde al `accessibilityIdentifier`. Este valor no lleva prefijo de paquete.

  - **Regla de Oro:** Si ambos equipos (iOS y Android) usan el mismo identificador base (ej. `btn_login`), utiliza `id: ".*btn_login"` en `flows/screens/common/` para unificar ambos selectores en una sola línea.

 

- **Prioridad 2 — Etiquetas de Accesibilidad y Texto (`text`):**

  - En **Swift**, Maestro lee `accessibilityLabel` y el texto visible bajo el atributo `text`.

  - En **Kotlin**, lee `contentDescription` y `text` bajo el atributo `text`.

  - Si un botón nativo es solo un ícono (sin texto visible), busca su `accessibilityLabel` (iOS) o `contentDescription` (Android) en `inspect_screen`.

 

- **Prioridad 3 — Coordenadas Relativas (`point`):**

  - Úsalas únicamente como último recurso para gestos personalizados en mapas o canvas nativos.

 

## 2. Manejo de Diferencias Nativas (UIKit/SwiftUI vs Views/Compose)

- **Navegación hacia Atrás:**

  - En **Android**, utiliza el comando nativo `- back`.

  - En **iOS**, el comando `back` no existe como botón de hardware. Crea un subflujo o condición que toque el botón de navegación superior (`id: ".*btn_back"` o `text: "Atrás"` / `"Back"`) o realice un gesto de deslizamiento desde el borde izquierdo (`swipe` de `1%, 50%` a `80%, 50%`).

- **Diálogos y Permisos del Sistema:**

  - Los alertas nativos (`UIAlertController` en iOS y `AlertDialog` en Android) tienen textos y botones distintos. Manéjalos siempre separando los archivos en `flows/screens/android/` y `flows/screens/ios/`.

- **Listas Largas (`UITableView` / `LazyColumn` / `RecyclerView`):**

  - En iOS, los elementos fuera de pantalla a veces existen en el árbol de accesibilidad pero no son visibles; en Android (RecyclerView), los elementos no se crean hasta hacer scroll.

  - Por ello, usa siempre `scrollUntilVisible` con `centerElement: true` antes de hacer `tapOn` en listas nativas.

 

## 3. Implementación de Page Object Model (POM) en YAML

- **Archivos de Pantalla (`flows/screens/common/<pantalla>_screen.yaml`):**

  - Valida siempre la carga de la pantalla al inicio con `assertVisible` apuntando al contenedor o título principal.

  - Recibe acciones y datos mediante variables de entorno `${ACTION}` y `${PARAM}`.

  - Ejemplo nativo unificado:

    ```yaml

    appId: ${APP_PACKAGE}

    ---

    # Validar que la pantalla nativa cargó

    - assertVisible:

        id: ".*login_container"

 

    - runFlow:

        when:

          true: \${ACTION == 'SUBMIT_CREDENTIALS'}

        commands:

          - tapOn:

              id: ".*input_email"

          - inputText: \${USER_EMAIL}

          - tapOn:

              id: ".*input_password"

          - inputText: \${USER_PASSWORD}

          - hideKeyboard

          - tapOn:

              id: ".*btn_login"

    ```

 

## 4. Prohibiciones Estrictas

- **NO** uses `wait` con tiempos estáticos largos. Usa `extendedWaitUntil` ligado a la visibilidad de un elemento nativo clave.

- **NO** hardcodees credenciales ni URLs de API en los archivos YAML; pásalos mediante variables de entorno `${VAR_NAME}`.
