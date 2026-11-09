# Entre Senderos

Sitio de talleres de escritura en español: programas, precios de US$50, calendario en hora de Costa Rica, muestra de relatos y administración.

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
- Las solicitudes del boletín quedan guardadas, pero esta muestra no envía campañas ni correos automáticos. Tampoco realiza pagos ni confirma reservas.
- El número de WhatsApp, el correo de contacto y la identidad del equipo se incorporan cuando estén confirmados.

## Infraestructura independiente para demo y producción

La plantilla `infra\main.bicep` crea una Static Web App Free para la demo y Standard para producción, que requiere autenticación personalizada de Microsoft Entra. Cada entorno tiene su cuenta de almacenamiento Standard LRS. Producción tiene el costo del plan Standard y el almacenamiento tiene cargos por uso; los entornos no comparten contenido ni credenciales.

Ejemplo para una suscripción y un grupo de recursos nuevos:

```powershell
az login
az account set --subscription "<subscription-id>"
az group create --name rg-entre-senderos-demo --location eastus2
az deployment group create --resource-group rg-entre-senderos-demo --template-file infra\main.bicep --parameters environment=demo adminGitHubLogins="<github-login>"
```

Para producción, selecciona su suscripción y usa otro grupo de recursos con `environment=production`. No es necesario que pertenezca a la misma infraestructura o suscripción que la demo. Los nombres de recursos y las credenciales de almacenamiento se generan para ese despliegue. La plantilla no publica las claves como salidas.

En GitHub, crea un environment `demo` o `production` y guarda el token de despliegue de su Static Web App como `AZURE_STATIC_WEB_APPS_API_TOKEN`:

```powershell
az staticwebapp secrets list --name "<site-name>" --resource-group "<resource-group>" --query properties.apiKey --output tsv | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --env demo --repo julianastorga/entre-senderos
```

Los cambios en `main` despliegan únicamente la demo. Producción se despliega manualmente desde GitHub Actions, seleccionando `production`; conviene exigir aprobación en ese environment. No se crea ni se modifica una infraestructura de producción automáticamente.

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

Consulta [la documentación del boletín](docs/newsletter.md) para descargar las direcciones privadas, implementar doble confirmación y bajas, administrar la lista y configurar campañas programadas. La muestra rechaza correos de ejemplo y dominios sin correo, limita una solicitud aceptada por sesión y guarda las direcciones como pendientes de confirmación. La gestión visual de listas y el envío programado se documentan como trabajo pendiente; no se envían correos actualmente.
