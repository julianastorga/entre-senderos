import { CLOUD_MODE } from "./app-config.mjs";
import { apiRequest } from "./content-store.mjs";

const params = new URLSearchParams(location.search);
const action = params.get("action");
const token = params.get("token");
const button = document.querySelector("#subscription-action");
const status = document.querySelector("#subscription-status");
history.replaceState(null, "", location.pathname);
if (!CLOUD_MODE) status.textContent = "Las confirmaciones y las bajas solo están disponibles en el sitio conectado a Azure.";
else if (!["confirm", "unsubscribe"].includes(action) || !token) status.textContent = "El enlace no es válido. Abre el enlace completo que recibiste por correo.";
else {
  button.textContent = action === "confirm" ? "Confirmar mi suscripción" : "Dar de baja mi dirección";
  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { value } = await apiRequest(`mail/subscription/${action}`, { method: "POST", body: { token } });
      status.textContent = value.message; button.hidden = true;
    } catch (error) { status.textContent = `No se confirmó el cambio. ${error.message}`; button.disabled = false; }
  });
}
