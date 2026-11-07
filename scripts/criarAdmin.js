// Cria o primeiro usuário admin (POST /usuarios exige um admin já logado).
// Uso: preencha ADMIN_NOME, ADMIN_EMAIL e ADMIN_SENHA no .env e rode `npm run seed:admin`.
import "dotenv/config";
import models, { sequelize } from "../src/models/index.js";
import usuarioService from "../src/services/usuarioService.js";

const { ADMIN_NOME, ADMIN_EMAIL, ADMIN_SENHA } = process.env;

if (!ADMIN_NOME || !ADMIN_EMAIL || !ADMIN_SENHA) {
  console.error("Defina ADMIN_NOME, ADMIN_EMAIL e ADMIN_SENHA no .env");
  process.exit(1);
}

try {
  await sequelize.sync();

  const existente = await models.Usuario.findOne({
    where: { email: ADMIN_EMAIL },
  });

  if (existente) {
    console.log(`Usuário ${ADMIN_EMAIL} já existe (role: ${existente.role}).`);
  } else {
    const admin = await usuarioService.criar({
      nome: ADMIN_NOME,
      email: ADMIN_EMAIL,
      senha: ADMIN_SENHA,
      role: "admin",
    });
    console.log(`Admin criado: id ${admin.id}, ${admin.email}`);
  }
} catch (erro) {
  console.error("Erro ao criar admin:", erro.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
