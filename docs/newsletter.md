# Boletin: Google Workspace, lista y campañas

## Administracion y destinatarios

En `admin.html`, **Contactos** configura el numero de WhatsApp con codigo de pais y el correo publico. **Boletin** configura un buzon de Google Workspace, gestiona direcciones y permite guardar, enviar y programar campañas de texto simple. Son configuraciones independientes: el buzon publico no tiene que enviar las campañas.

La API guarda solicitudes y lista en Blob Storage privado. Solo administradores autorizados pueden leer direcciones, exportar solicitudes, modificar la lista o enviar campañas. En Ediciones, **Solicitudes y boletin** permite exportar JSON recorriendo todas las paginas. No publiques exportaciones ni las guardes en el repositorio.

Las solicitudes exigen consentimiento, sintaxis valida y un dominio con MX; rechazan dominios reservados para ejemplos. Una cookie HttpOnly de sesion impide repetir solicitudes aceptadas en el mismo navegador, incluso tras recargar u abrir otra pestaña. Hay tambien un limite por red. Borrar cookies no debe considerarse proteccion antiautomatizacion.

Un dominio real no demuestra que exista un buzon ni que pertenezca a quien completa el formulario. Solo `confirmed` recibe campañas. El estado inicial es `pending_confirmation`; con el correo habilitado se envia un enlace aleatorio de un solo uso, valido durante 24 horas. Se almacena su hash, no el token. El enlace necesita una confirmacion explicita en la pagina, no basta con que un escaner lo visite.

La administracion puede reenviar una confirmacion pendiente (una vez cada 15 minutos), dar de baja y eliminar registros. `unsubscribed` no se reactiva ni recibe nuevas confirmaciones automaticamente. Conservar su registro mantiene la exclusion; eliminarlo permite que esa direccion vuelva a solicitar una suscripcion nueva. No hay un boton para confirmar destinatarios sin verificar el buzon.

## Conectar Google Workspace

1. Define el dominio y crea un buzon dedicado, por ejemplo `novedades@<dominio>`. Habilita Gmail para esa cuenta y configura SPF, DKIM y DMARC.
2. En un proyecto de Google Cloud de la organizacion, habilita Gmail API, configura el consentimiento OAuth como interno para Workspace y crea un cliente OAuth de aplicacion web.
3. Registra exactamente `https://<dominio-del-sitio>/api/mail/google/callback` como URI de retorno. Para la demo usa su hostname de Azure. El origen publico configurado en Azure debe coincidir; no se deriva de cabeceras enviadas por visitantes.
4. En Boletin guarda dominio, buzon remitente, nombre, Reply-To, ID y secreto del cliente. El secreto solo se introduce para crearlo o cambiarlo y nunca se devuelve ni se guarda en localStorage.
5. Conecta Google Workspace y autoriza **ese mismo buzon**. Se solicitan `openid`, `email` y `gmail.send`, con OAuth offline y PKCE. La API verifica token, dominio Workspace, correo verificado, audiencia y estado de autorizacion de un solo uso, vinculado al navegador.
6. Envia una prueba a la cuenta conectada. Luego habilita los envios y guarda la configuracion. Conectar no activa envios por si solo.

El secreto del cliente y el refresh token se cifran con AES-256-GCM usando una clave privada independiente (`MAIL_SETTINGS_SECRET`, al menos 32 caracteres). No la rotes sin descifrar y volver a cifrar la configuracion o reconectar Google. No se guarda la contraseña de Google. Desconectar elimina la autorizacion local y deshabilita envios; revoca tambien el permiso desde la cuenta de Google si deseas invalidar el consentimiento en Google.

Si faltan dominio, cliente OAuth, buzon o autorizacion, no se envian campañas. Los formularios pueden guardar solicitudes pendientes; muestran explicitamente si no se confirmo el envio del correo de verificacion. Los registros duplicados no provocan reenvios ni reactivan bajas.

## Programacion y bajas

Guarda un borrador con asunto y contenido, revisalo y selecciona Enviar ahora o una fecha futura en **hora de Costa Rica (`America/Costa_Rica`, UTC-6)**. Se almacena el instante UTC. Solo se puede editar un borrador; para cambiar una campaña programada cancela y crea otro borrador.

La programacion necesita el Logic App de consumo definido en `infra\main.bicep`, habilitado mediante `ENABLE_MAIL_SCHEDULER=true` en el environment `demo` de GitHub. Este consulta cada cinco minutos y procesa hasta 20 destinatarios por invocacion, no en el instante exacto elegido. Tiene cargos por ejecuciones y acciones; revisa presupuesto y alertas. Sin recurso desplegado, la interfaz no permite programar; se puede procesar manualmente una cola desde administracion.

El dispatcher usa una reserva exclusiva con expiracion y recibos por campaña/destinatario. Guarda progreso entre lotes y comprueba la confirmacion y las bajas antes de cada envio. No reintenta un resultado ambiguo de Gmail: marca `needs_review` para revisar Enviados antes de decidir otra campaña. Los estados de aceptacion no garantizan entrega. Las cuotas, rebotes y quejas de Gmail no se procesan automaticamente: revisa el buzon y da de baja direcciones que fallen. Para una lista grande, integra un proveedor especializado y seguimiento de entrega antes de usarla en produccion.

Cada campaña añade un enlace de baja firmado y cabeceras RFC8058 con un endpoint POST de un clic. La baja no requiere autenticacion y los enlaces antiguos de confirmacion no reactivan una baja. Cancelar se permite antes de que comience el envio; no recupera mensajes ya aceptados por Gmail.

## Despliegue exclusivamente desde main

No despliegues con la CLI desde un equipo ni desde una rama de PR. El workflow solo despliega tras un **push a `main`**. El environment `demo` esta limitado a esa rama.

Para administrar infraestructura desde ese mismo workflow, configura en el environment `demo` las variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` y `AZURE_SUBSCRIPTION_ID` de una identidad Azure con federacion OIDC para `repo:julianastorga/entre-senderos:environment:demo`, con permisos limitados al grupo de recursos de demo. Esta autorizacion inicial debe establecerla la persona administradora de Azure. Sin ella, el workflow despliega sitio/API con el token SWA existente pero no modifica infraestructura ni habilita el servicio de correo.

`scripts\provision-demo.mjs` solo se ejecuta en GitHub Actions para un push a main. Conserva las credenciales de demo existentes, genera claves independientes de correo si faltan y aplica Bicep. No imprime secretos; los parametros temporales se eliminan. La clave del scheduler se guarda como parametro seguro del Logic App y se ocultan entradas/salidas del historial.

No existe aun un dominio/buzon/cliente Google proporcionado para esta muestra: no se ha conectado una cuenta ni enviado correo real. Las pruebas usan un cliente Gmail simulado, no una distribucion real.

Antes de usar datos reales, define politica de privacidad y retencion, destinatarios autorizados para la demo, limites de Gmail, presupuesto, supervisión y tratamiento de rebotes/quejas. La autenticacion de administracion de produccion sigue siendo Microsoft Entra con dominio exacto; conectar Gmail no cambia ese proveedor de acceso.
