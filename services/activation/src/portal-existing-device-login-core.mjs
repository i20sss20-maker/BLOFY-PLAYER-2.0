const WEB_REGISTRATION_CHECK = /\s*const activation = await api\("\/api\/v1\/activation\/check", "POST", \{\s*appVersion: "web-portal",\s*platform: "web"\s*\}\);\s*if \(activation\.status !== "trial" && activation\.status !== "active"\) \{\s*throw new Error\("unauthorized_device"\);\s*\}\s*/m;

export function removePortalRegistrationCheck(html) {
  const source = String(html || '');
  return source.replace(WEB_REGISTRATION_CHECK, '\n        ');
}
