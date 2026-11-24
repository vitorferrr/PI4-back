const EMAIL_VALIDO = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;

const emailValido = (valor) => typeof valor === "string" && EMAIL_VALIDO.test(valor);

export default emailValido;
