# Boletin: lista de distribucion y envios programados

## Disponible en la muestra

Las solicitudes del formulario se guardan en el contenedor privado de Azure Blob Storage, bajo `submissions/newsletter/`. No son visibles para visitantes ni estan en el repositorio. La API elimina espacios, normaliza el correo, exige consentimiento y rechaza formatos invalidos, dominios reservados para ejemplos y dominios sin registros MX de correo.

Despues de una solicitud aceptada, una cookie de sesion HttpOnly impide otra solicitud desde el mismo navegador; el formulario queda deshabilitado incluso al recargar o abrir otra pestana. Los errores se pueden corregir antes de enviar una solicitud aceptada. Hay ademas un limite por direccion de red de una solicitud por minuto. Borrar cookies o cambiar de navegador inicia otra sesion: esto no sustituye un mecanismo antiautomatizacion.

Una direccion con sintaxis correcta y un dominio real aun puede corresponder a un buzon inexistente, temporal o de otra persona. **Esta muestra no verifica la propiedad del buzon y no envia correos.** Las solicitudes nuevas tienen estado `pending_confirmation`; no deben usarse como destinatarios activos sin confirmacion.

## Leer las direcciones como administrador

1. Inicia sesion en `admin.html`.
2. En la pestana Talleres, abre Solicitudes y boletin.
3. Selecciona Descargar solicitudes del boletin para obtener un archivo JSON privado. El cliente recorre todas las paginas de la API, no solamente los primeros 100 registros.

La API autorizada es `GET /api/submissions?kind=newsletter`; devuelve `items` y un `continuationToken` para la siguiente pagina. No pongas este enlace ni sus resultados en una pagina publica. En produccion, solo las cuentas de Microsoft Entra del dominio permitido pueden descargar datos.

Para analizar una descarga localmente:

```powershell
Get-Content .\newsletter.json -Raw |
  ConvertFrom-Json |
  Select-Object email, status, consent, createdAt |
  Export-Csv .\newsletter.csv -NoTypeInformation -Encoding utf8
```

Protege y elimina las descargas cuando dejen de ser necesarias. Los registros antiguos sin estado tambien se deben considerar pendientes de confirmacion, no suscriptores activos.

## Requisitos para administrar una lista real

Se necesita una vista administrativa Boletin con busqueda, paginacion, filtros, confirmacion, baja, supresion y eliminacion. Una exportacion no equivale a gestionar esas operaciones; esa vista aun no esta implementada.

El modelo debe distinguir `pending_confirmation`, `confirmed`, `unsubscribed`, `bounced` y `complained`, con fecha de consentimiento, version del aviso de privacidad y fechas de cambio. Solo `confirmed` puede recibir campañas. No reactivar automaticamente una baja cuando se vuelva a introducir el mismo correo.

Implementar doble confirmacion:

1. Crear un token aleatorio de un solo uso, guardar solo su hash y establecer una caducidad.
2. Enviar al buzon una solicitud de confirmacion; limitar reenvios para no facilitar abuso.
3. Activar la direccion solamente al confirmar el token. Expirar y eliminar solicitudes pendientes segun la politica de retencion.
4. Ofrecer un enlace de baja firmado y una baja de un clic compatible con el proveedor. Las bajas no deben requerir iniciar sesion.
5. Procesar rebotes permanentes y quejas, mantener una lista de supresion y volver a comprobarla inmediatamente antes de cada envio.

Cada operacion administrativa necesita autorizacion en la API, control de concurrencia y auditoria sin copiar correos ni contenido privado a los logs.

## Proveedor y configuracion de salida

Una opcion en Azure es Azure Communication Services Email; tambien puede integrarse un proveedor especializado con gestion de listas. Antes de habilitar envios:

- Confirmar el dominio remitente y verificar sus registros DNS, SPF y DKIM; publicar una politica DMARC adecuada.
- Configurar direccion y nombre del remitente, Reply-To, identidad editorial, aviso de privacidad y direccion/contacto legal aplicable.
- Configurar limites, presupuesto y alertas; guardar las credenciales solo en Azure/Key Vault o usar identidad administrada con el rol minimo necesario.
- Registrar eventos de entrega mediante un endpoint autenticado o Event Grid, e implementar tratamiento de rebotes y quejas.
- Separar demo y produccion: el entorno de muestra debe usar un modo sin entrega o destinatarios de prueba autorizados, nunca la lista real.

La interfaz administrativa debe permitir crear y editar una configuracion de salida (proveedor, remitente, Reply-To y zona horaria), comprobar su estado y enviar una prueba controlada. Las claves no deben devolverse al navegador ni incluirse en las exportaciones.

## Programacion de contenido

La interfaz debe permitir borradores con asunto, version HTML y texto simple, seleccion de destinatarios confirmados, vista previa, envio de prueba, fecha/hora de salida, pausa y cancelacion. Mostrar las horas en `America/Costa_Rica` y guardar el instante UTC.

Las API administradas de Static Web Apps son HTTP; para ejecutar trabajos programados se necesita una Azure Function independiente con temporizador y una cola durable, o un servicio equivalente. Ese recurso debe provisionarse por entorno, con su propio presupuesto y permisos.

Flujo recomendado:

1. Guardar la campaña como borrador; publicar su programacion con version y auditoria de la cuenta administradora.
2. El temporizador reclama campañas vencidas con una transicion atomica; no enviar directamente desde el navegador.
3. Crear trabajos por destinatario con una clave idempotente por campaña y direccion. Respetar cuotas, reintentar fallos temporales y enviar fallos persistentes a una cola de errores.
4. Revalidar consentimiento y supresiones antes de cada entrega. Las bajas posteriores a programar una campaña deben excluirse.
5. Registrar identificadores del proveedor y estado de entrega. Una respuesta aceptada del proveedor no equivale a entrega; ante una respuesta perdida, reconciliar antes de reintentar para evitar duplicados.
6. Mostrar progreso y errores al administrador; la cancelacion detiene trabajos pendientes, no recupera correos ya enviados.

Antes de habilitarlo, probar doble confirmacion, caducidad y reutilizacion de tokens, bajas, correos duplicados, concurrencia, desfases de zona horaria, reinicios del scheduler, reintentos, cancelacion, permisos y aislamiento demo/produccion.

**Pendiente de implementar:** proveedor, correos de confirmacion, bajas, gestion visual de la lista, configuraciones de salida, editor de campañas y scheduler. La muestra actual solo captura y exporta solicitudes privadas con las protecciones descritas arriba.
