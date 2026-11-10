import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js/max";

const countries = new Set(getCountries());

export function phoneCountries() {
  const names = new Intl.DisplayNames(["es"], { type: "region" });
  return [...countries].map((country) => ({
    country, callingCode: getCountryCallingCode(country), label: `${names.of(country)} (+${getCountryCallingCode(country)})`,
  })).sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function validatePhone(input) {
  if (!countries.has(input?.phoneCountry)) throw new Error("Elige el país del teléfono.");
  const value = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!value || value.length > 40 || !/^\+?[\d\s().-]+$/u.test(value)) throw new Error("Escribe un teléfono válido con su código de país o su número nacional.");
  const phone = parsePhoneNumberFromString(value, { defaultCountry: input.phoneCountry, extract: false });
  if (!phone?.isValid() || phone.ext) throw new Error("Revisa el teléfono y el país seleccionado.");
  if (!phone.country || phone.country !== input.phoneCountry) throw new Error("El código internacional no coincide con el país seleccionado.");
  return { phone: phone.number, phoneCountry: phone.country };
}
