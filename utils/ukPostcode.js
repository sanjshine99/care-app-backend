const UK_POSTCODE_FORMAT_REGEX =
  /^(GIR 0AA|[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2})$/;

function isValidUkPostcodeFormat(normalized) {
  if (!normalized || typeof normalized !== "string") return false;
  return UK_POSTCODE_FORMAT_REGEX.test(normalized);
}

function normalizeUkPostcode(raw) {
  if (raw == null || typeof raw !== "string") return "";
  const upper = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (UK_POSTCODE_FORMAT_REGEX.test(upper)) return upper;

  const compact = upper.replace(/\s/g, "");
  if (compact === "GIR0AA") return "GIR 0AA";
  if (compact.length >= 5) {
    const candidate = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
    if (UK_POSTCODE_FORMAT_REGEX.test(candidate)) return candidate;
  }
  return upper;
}

module.exports = {
  UK_POSTCODE_FORMAT_REGEX,
  isValidUkPostcodeFormat,
  normalizeUkPostcode,
};
