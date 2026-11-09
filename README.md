# Entre Senderos

Sitio de escritura en español: talleres con ediciones independientes de US$50, servicios personalizados, calendario en hora de Costa Rica, blog Editorial y administración.

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
- Cada taller tiene descripción, objetivos, lecturas requeridas, modalidad editable (inicialmente «Taller corto»), detalles adicionales, portada y página propia. Los objetivos y lecturas sin completar se indican como pendientes, sin inventar contenidos. La portada subida reemplaza una ilustración provisional identificada como ejemplo. Estos campos pertenecen al taller, no a sus ediciones; las copias del catálogo los conservan. Sus ediciones tienen códigos, fechas, recurrencia y formularios independientes. La migración conserva horarios e identificadores anteriores, incluidos talleres personalizados existentes.
- Servicios es un catálogo editable de propuestas a medida, independiente del calendario. La consulta identifica el servicio solicitado.
- Editorial es un solo blog, sin categorías ni diferencias visuales entre textos. Cada publicación admite crédito de autoría y enlace externo opcionales; el enlace requiere un nombre y aparece tanto en su ficha como en la lectura completa. El editor permite insertar, editar y quitar enlaces HTTP(S) seguros, también conservados al pegar o importar documentos. Los enlaces abren otra pestaña con `noopener noreferrer`.
- La paginación conserva seis publicaciones y URLs compartibles; en Azure solo se descargan las fichas de esa página. Los antiguos campos de categoría se ignoran sin perder textos, créditos ni fechas. Las fechas se muestran en `America/Costa_Rica`; las nuevas publicaciones reciben fecha del servidor y las antiguas sin fecha no reciben una fecha inventada hasta guardarlas.
- Cada lectura permite añadir o retirar independientemente las seis reacciones de Gatugramas. Azure guarda recuentos compartidos y elecciones por navegador mediante una cookie aleatoria de primera parte, `HttpOnly`, `Secure`, `SameSite=Lax`, con duración de un año; no se usa fingerprinting. La API solo devuelve recuentos y elecciones propias, nunca identificadores de otras personas. Los cambios son idempotentes, usan versiones y tienen un límite de 60 solicitudes por minuto y dirección de origen. Esto no identifica personas únicas ni impide que alguien borre sus cookies. La vista previa local solo guarda reacciones en ese navegador.
- Administración permite configurar WhatsApp y correo público, conectar Google Workspace mediante OAuth, administrar confirmaciones/bajas y crear campañas programadas. No se realizan pagos ni se confirman reservas.
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

## Operación del boletín

Consulta [la documentación del boletín](docs/newsletter.md) para conectar Google Workspace, administrar y exportar direcciones privadas, confirmar suscripciones, tramitar bajas y configurar campañas. La muestra rechaza correos de ejemplo y dominios sin correo, limita una solicitud aceptada por sesión y solo envía campañas a direcciones confirmadas. La autorización del dominio y la entrega real requieren el futuro buzón Google; no forman parte de las pruebas simuladas.
