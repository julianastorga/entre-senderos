import { phoneCountries, validatePhone } from "./phone-model.mjs";

export { validatePhone };

export function initPhoneInput(form) {
  const country = form.elements.phoneCountry;
  if (!country) return;
  const selected = country.value || "CR";
  country.replaceChildren(...phoneCountries().map(({ country: value, callingCode, label }) => {
    const option = new Option(label, value, value === "CR", value === selected);
    option.dataset.callingCode = callingCode;
    return option;
  }));
  function placeholder() { form.elements.phone.placeholder = `Nacional o +${country.selectedOptions[0].dataset.callingCode}...`; }
  placeholder();
  country.addEventListener("change", () => {
    placeholder();
    const phone = form.elements.phone;
    phone.setAttribute("aria-invalid", "false");
    form.querySelector("#signup-phone-error").textContent = "";
  });
}
