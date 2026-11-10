# Entre Senderos

Sitio de escritura en español: talleres con ediciones independientes de US$50, servicios personalizados, calendario en hora de Costa Rica, blog y administración.

La implementación inicial se revisa en la rama `feat/azure-sample`. Mientras no se haya integrado el PR, usa esa rama para seguir las instrucciones de desarrollo.

Muestra de Azure: https://orange-mushroom-0c033e60f.4.azurestaticapps.net

## Desarrollo local

```powershell
npm ci
npm test
npm run build
python -m http.server 4173 --bind 127.0.0.1
```

El sitio fuente en `http://127.0.0.1:4173/` funciona como prototipo local: guarda los talleres y los textos solamente en ese navegador y los formularios no envían datos. No utiliza las credenciales de Azure.

`npm run build` genera `dist` para Azure, la API administrada y el conversor local de Word. La aplicación desplegada usa almacenamiento compartido; no utiliza el almacenamiento del navegador como sustituto si la API falla.

## Aplicación alojada

- Azure Static Web Apps: sitio, HTTPS, autenticación de GitHub y API administrada con Node.js 22.
- Azure Blob Storage privado: talleres, relatos, solicitudes de inscripción y solicitudes del boletín.
- API: lectura pública de talleres y relatos; solo las cuentas autorizadas pueden modificar contenido o descargar solicitudes.
- Los cambios se protegen mediante versiones para evitar sobrescribir otras sesiones.
- El editor admite HTML, TXT, DOC y DOCX. La conversión de Word ocurre en un worker del navegador, sin enviar los archivos originales a terceros. Se conserva el formato básico, no el diseño exacto de Word.
- Cada taller tiene descripción, secciones «En qué consiste» y «A quién está dirigido», objetivos, lecturas recomendadas, modalidad editable (inicialmente «Taller corto»), detalles adicionales, portada y página propia. Los campos sin completar se indican como pendientes, sin inventar contenidos. La portada aparece como fondo del título y la descripción, con una capa oscura para mantener el texto legible. La imagen subida reemplaza una ilustración provisional identificada como ejemplo. Estos campos pertenecen al taller, no a sus ediciones; las copias del catálogo y los editores antiguos los conservan. Sus ediciones tienen códigos, fechas, recurrencia y formularios independientes. La migración conserva horarios e identificadores anteriores, incluidos talleres personalizados existentes.
- `cursos.html` muestra las próximas ediciones, sin comparación de precios: comienzan hoy o más adelante según `America/Costa_Rica` y se ordenan por fecha, hora y código. Cada una enlaza a su taller y a su solicitud específica; si no hay próximas fechas se indica expresamente. El precio por edición aparece en la página del taller, incluso sin fechas programadas, y al seleccionar una edición en el formulario. Los servicios indican que requieren una propuesta personalizada; orientación no muestra un precio de taller. No se realizan cobros.
- Servicios es un catálogo editable de propuestas a medida, independiente del calendario. La consulta identifica el servicio solicitado.
- El blog destaca la publicación más reciente y muestra las anteriores en fichas con título, subtítulo e imagen, enlazadas a su lectura completa. El subtítulo es opcional, de hasta 300 caracteres; las fichas antiguas sin subtítulo usan un extracto y las que no tienen portada muestran una ilustración provisional identificada. Cada publicación admite hasta 10 etiquetas de 40 caracteres, sin duplicados por mayúsculas o composición Unicode. La nube lateral muestra sus frecuencias, permite filtrar y pasa encima del contenido en móvil. El editor permite añadir, cambiar o quitar subtítulos y etiquetas; los editores antiguos no pueden borrarlos accidentalmente en Azure.
- Una colección sin inicializar comienza con dos publicaciones ficticias editables y eliminables: el relato de los siete gatos y «Dos voces, un mismo sendero», con coautorías, etiquetas y enlace externo en el crédito y en el texto. `https://example.org/` es un marcador, no el blog de una persona real. Azure guarda estos ejemplos una sola vez, sin reemplazar colecciones existentes; localmente se guardan al modificar la colección. Borrar la última publicación conserva el blog vacío, incluso al recargar. Solo «Restablecer blog de ejemplo» recupera las muestras. El administrador puede quitar la identificación de muestra al sustituirla por contenido propio. `sample-posts.mjs` se genera al compilar a partir del relato original de `texto.html`, conservando sus 1000 palabras.
- La paginación conserva seis publicaciones anteriores por página, sin repetir la destacada, y URLs compartibles con `etiqueta` y `pagina`. El filtro destaca la publicación más reciente de esa etiqueta y reinicia la paginación. En Azure solo se descargan la ficha destacada, las fichas de esa página y los recuentos, no todos los artículos completos. Los antiguos campos de categoría se ignoran y se conservan las URLs `muestra.html`, `texto.html?id=…` y `admin.html#editorial`, sin perder textos, créditos ni fechas. Las fechas se muestran en `America/Costa_Rica`; las nuevas publicaciones reciben fecha del servidor y las antiguas sin fecha no reciben una fecha inventada hasta guardarlas.
- Cada publicación admite crédito de autoría y enlace externo opcionales; el enlace requiere un nombre y aparece tanto en su ficha como en la lectura completa. El editor permite insertar, editar y quitar enlaces HTTP(S) seguros, también conservados al pegar o importar documentos. Los enlaces abren otra pestaña con `noopener noreferrer`.
- Cada lectura permite añadir o retirar independientemente las seis reacciones de Gatugramas. Azure guarda recuentos compartidos y elecciones por navegador mediante una cookie aleatoria de primera parte, `HttpOnly`, `Secure`, `SameSite=Lax`, con duración de un año; no se usa fingerprinting. La API solo devuelve recuentos y elecciones propias, nunca identificadores de otras personas. Los cambios son idempotentes, usan versiones y tienen un límite de 60 solicitudes por minuto y dirección de origen. Esto no identifica personas únicas ni impide que alguien borre sus cookies. La vista previa local solo guarda reacciones en ese navegador.
- Administración permite configurar WhatsApp y correo público, conectar Google Workspace mediante OAuth, administrar confirmaciones/bajas y crear campañas programadas. No se realizan pagos ni se confirman reservas.
- Las solicitudes de talleres y servicios requieren teléfono y país, con selector internacional inicialmente en Costa Rica y validación compartida cliente/servidor. Se guarda el número normalizado E.164; el boletín no solicita teléfono. La pestaña «Inscripciones» muestra contactos privados, la edición solicitada y estados editables: Interesado, Confirmado, En asistencia, Retirado y Finalizado. Sus páginas cargan hasta 100 registros; los cambios usan versiones y no envían mensajes. Las solicitudes anteriores sin teléfono o estado siguen disponibles, inicialmente como interesadas. La vista previa local no guarda contactos.
- Las cargas de datos muestran esqueletos con brillo y anuncios accesibles; la preferencia de movimiento reducido desactiva la animación. Las actualizaciones en segundo plano conservan el contenido y los cambios sin guardar. Todos los pies de página incluyen el crédito de desarrollo enlazado, sin sustituir la identidad pendiente del sitio.
- El correo permanece deshabilitado hasta configurar la infraestructura privada, el dominio y el buzón. No se ha conectado una cuenta Google ni enviado correo real.

## Infraestructura independiente para demo y producción

La plantilla `infra\main.bicep` crea una Static Web App Free para la demo y Standard para producción, que requiere autenticación personalizada de Microsoft Entra. Cada entorno tiene su cuenta de almacenamiento Standard LRS. Producción tiene el costo del plan Standard y el almacenamiento tiene cargos por uso; los entornos no comparten contenido ni credenciales.

**Los despliegues solo se realizan mediante GitHub Actions tras commits en `main`.** Los PR ejecutan pruebas y compilación, nunca despliegan. No hay `workflow_dispatch` ni despliegue manual con la CLI. El environment `demo` solo admite la rama `main`; esta rama de PR no actualiza la muestra de Azure hasta integrarse.

Para producción, selecciona su suscripción y usa otro grupo de recursos con `environment=production`. No es necesario que pertenezca a la misma infraestructura o suscripción que la demo. Los nombres de recursos y las credenciales de almacenamiento se generan para ese despliegue. La plantilla no publica las claves como salidas.

En GitHub, crea un environment `demo` o `production` y guarda el token de despliegue de su Static Web App como `AZURE_STATIC_WEB_APPS_API_TOKEN`:

```powershell
az staticwebapp secrets list --name "<site-name>" --resource-group "<resource-group>" --query properties.apiKey --output tsv | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --env demo --repo julianastorga/entre-senderos
```

Los cambios en `main` despliegan únicamente la demo. Producción no tiene un job de despliegue habilitado; requerirá una configuración revisada en main, credenciales independientes y aprobación de su environment. No se crea ni se modifica infraestructura de producción automáticamente.

La provisión opcional del mismo workflow usa OIDC de Azure, restringido al environment demo y a su grupo de recursos. Configura sus variables de identidad según [la documentación del boletín](docs/newsletter.md). El script conserva las credenciales existentes y genera claves privadas de correo independientes. Habilitar el programador Logic Apps tiene cargos por uso; permanece desactivado si no se selecciona expresamente. Sin OIDC se publica sitio/API con el token SWA existente, sin modificar infraestructura.

## Administración y cuenta de demostración

En la demo, la autenticación de GitHub permite administrar a los usuarios incluidos en `adminGitHubLogins`, separados por comas. La API comprueba la identidad; ocultar botones no constituye la autorización.

En producción, solo se permite administrar a cuentas de Microsoft Entra cuyo nombre de usuario autenticado pertenezca **exactamente** a `productionAllowedDomain` (sin `@`, sin admitir subdominios). El dominio puede definirse posteriormente: si falta el dominio o `productionTenantId`, la administración permanece deshabilitada. Ni la cuenta de demostración ni la lista de GitHub conceden acceso de producción. Las páginas públicas siguen abiertas.

Para habilitarlo, registra una aplicación de Microsoft Entra de un solo tenant, configura su callback `https://<hostname>/.auth/login/aad/callback` y proporciona `productionTenantId`, `productionClientId`, `productionClientSecret` (parámetro seguro) y `productionAllowedDomain` al desplegar Bicep. Establece el mismo tenant como variable `PRODUCTION_ENTRA_TENANT_ID` en el environment `production` de GitHub para generar el issuer específico durante la compilación. No uses `common` ni `organizations` como issuer. Si compilas manualmente, usa `APP_ENVIRONMENT=production`. Verifica un acceso permitido y otro rechazado antes de publicar producción.

Opcionalmente, **solo la demo** admite un usuario y contraseña. La infraestructura recibe un hash scrypt con sal aleatoria en `demoPasswordHash` y una clave aleatoria de sesión en `demoSessionSecret`, ambos parámetros seguros. El formato del hash es `salHex.hashHex` (16 bytes de sal y 64 bytes derivados). Nunca incluyas la contraseña ni esos valores en el repositorio. La cuenta se configura mediante `demoAdminUsername`.

Las sesiones de prueba usan cookies HttpOnly, Secure y SameSite=Strict, vencen a las dos horas y tienen protección contra intentos repetidos. En producción, el acceso de demostración queda deshabilitado incluso si se proporcionan esos parámetros.

## Antes de usar datos reales

Esta es una aplicación de muestra. Define la política de privacidad, la retención y eliminación de datos personales, los contactos reales y el proveedor de correo antes de abrir inscripciones reales. Los formularios tienen consentimiento, un campo antispam y límites básicos de solicitudes; para tráfico público de producción, añade protección antiautomatización y supervisión acordes al uso.

Los archivos de Word con contraseña no se admiten. Revisa el formato y confirma la autorización y la autoría antes de guardar cada relato. Las licencias de las dependencias se incluyen en `assets\THIRD-PARTY-NOTICES.txt` al compilar.

## Notas locales y documentos privados

Guarda notas internas, informes operativos y exportaciones con contactos en `local-only\`, ignorado por Git y excluido de la publicación. También se ignoran los archivos `enrollment*.json` y `newsletter*.json` en la raíz para evitar añadir las descargas administrativas por accidente. No copies credenciales, contactos ni información interna a documentación pública, issues o PR.

La compilación limpia únicamente su carpeta generada `dist\` y copia listas explícitas de páginas y recursos públicos; no publica documentos, notas, backend ni exportaciones. Añade conscientemente a esas listas cualquier nueva página o recurso destinado al público. Ignorar un archivo no elimina versiones ya publicadas: si se expone una credencial, revócala y rótala.

## Operación del boletín

Consulta [la documentación del boletín](docs/newsletter.md) para conectar Google Workspace, administrar y exportar direcciones privadas, confirmar suscripciones, tramitar bajas y configurar campañas. La muestra rechaza correos de ejemplo y dominios sin correo, limita una solicitud aceptada por sesión y solo envía campañas a direcciones confirmadas. La autorización del dominio y la entrega real requieren el futuro buzón Google; no forman parte de las pruebas simuladas.
