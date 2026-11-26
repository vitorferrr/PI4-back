import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import models, { sequelize } from "../models/index.js";
import usuarioService from "../services/usuarioService.js";
import { enviarSenhaGerada } from "../services/emailService.js";

vi.mock("../models/index.js", () => ({
  sequelize: { transaction: vi.fn() },
  default: {
    Usuario: { create: vi.fn(), findOne: vi.fn(), findByPk: vi.fn() },
  },
}));
vi.mock("../services/emailService.js", () => ({ enviarSenhaGerada: vi.fn() }));

const { Usuario } = models;
const transacao = { id: "t1" };
const dados = { nome: "Carla Mendes", email: " Carla@Exemplo.com ", role: "fiscalizador", matricula: "104512" };

const usuarioCriado = (valores) => ({
  toJSON: () => ({ id: 7, ...valores }),
});

beforeEach(() => {
  vi.clearAllMocks();
  sequelize.transaction.mockImplementation(async (callback) => callback(transacao));
  Usuario.findByPk.mockResolvedValue({ nome: "Helena Matos" });
  Usuario.findOne.mockResolvedValue(null);
  Usuario.create.mockImplementation(async (valores) => usuarioCriado(valores));
  enviarSenhaGerada.mockResolvedValue({ id: "<id>" });
});

describe("cadastro com senha gerada", () => {
  it("cria o usuário com uma senha aleatória e envia essa senha por e-mail", async () => {
    const resultado = await usuarioService.criarComSenhaGerada(dados, 1);

    const salvo = Usuario.create.mock.calls[0][0];
    const { senha } = enviarSenhaGerada.mock.calls[0][0];

    expect(senha).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    expect(await bcrypt.compare(senha, salvo.senha_hash)).toBe(true);
    expect(Usuario.create).toHaveBeenCalledWith(expect.objectContaining({ email: "carla@exemplo.com" }), {
      transaction: transacao,
    });
    expect(Usuario.findOne).toHaveBeenCalledWith({ where: { email: "carla@exemplo.com" }, transaction: transacao });
    expect(Usuario.findByPk).toHaveBeenCalledWith(1, { attributes: ["nome"] });
    expect(enviarSenhaGerada).toHaveBeenCalledWith({
      para: "carla@exemplo.com",
      nome: "Carla Mendes",
      quemCadastrou: "Helena Matos",
      role: "fiscalizador",
      senha,
    });
    expect(resultado.senha_hash).toBeUndefined();
    expect(resultado).toMatchObject({ id: 7, nome: "Carla Mendes", matricula: "104512" });
  });

  it("ignora qualquer senha recebida e gera uma nova", async () => {
    await usuarioService.criarComSenhaGerada({ ...dados, senha: "123456" }, 1);

    expect(enviarSenhaGerada.mock.calls[0][0].senha).not.toBe("123456");
  });

  it("desfaz o cadastro e responde 503 quando o e-mail não sai", async () => {
    enviarSenhaGerada.mockRejectedValue(Object.assign(new Error("smtp"), { name: "EmailError" }));

    await expect(usuarioService.criarComSenhaGerada(dados, 1)).rejects.toMatchObject({
      statusCode: 503,
      message: "Não foi possível enviar o e-mail com a senha. O usuário não foi cadastrado; tente novamente.",
    });
  });

  it("repassa erros que não são de e-mail sem trocar a mensagem", async () => {
    enviarSenhaGerada.mockRejectedValue(new Error("Informe um e-mail de destino válido"));

    await expect(usuarioService.criarComSenhaGerada(dados, 1)).rejects.toThrow(
      "Informe um e-mail de destino válido"
    );
  });

  it("não envia e-mail quando o e-mail já está cadastrado", async () => {
    Usuario.findOne.mockResolvedValue({ id: 2 });

    await expect(usuarioService.criarComSenhaGerada(dados, 1)).rejects.toMatchObject({
      codigo: "EMAIL_CADASTRADO",
    });
    expect(enviarSenhaGerada).not.toHaveBeenCalled();
  });

  it("usa 'O administrador' quando não sabe quem cadastrou", async () => {
    await usuarioService.criarComSenhaGerada(dados);

    expect(Usuario.findByPk).not.toHaveBeenCalled();
    expect(enviarSenhaGerada.mock.calls[0][0].quemCadastrou).toBeUndefined();
  });
});
