import argon2 from "argon2";

// Único lugar que define como uma senha vira hash (cadastro, alteração, reenvio,
// migração do bcrypt no login e o hash fictício do login). Se um dia os parâmetros
// do Argon2 mudarem aqui, o hash fictício muda junto e o login com e-mail
// inexistente continua levando o mesmo tempo que o de um e-mail cadastrado.
const gerarHashSenha = (senha) => argon2.hash(senha);

export default gerarHashSenha;
