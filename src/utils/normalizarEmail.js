const normalizarEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : email;

export default normalizarEmail;
