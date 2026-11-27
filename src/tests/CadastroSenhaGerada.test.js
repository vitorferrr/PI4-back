import { beforeEach, describe, expect, it, vi } from "vitest";
import argon2 from "argon2";
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
const transacao = { id: "t1", LOCK: { UPDATE: "UPDATE" } };
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

    expect(senha).toMatch(/^[A-Z2-9]{12}$/);
    expect(await argon2.verify(salvo.senha_hash, senha)).toBe(true);
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
      reenvio: false,
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

describe("reenvio de senha", () => {
  const existente = () => {
    const dadosUsuario = { id: 7, nome: "Carla Mendes", email: "carla@exemplo.com", role: "gestor", senha_hash: "antigo" };
    return {
      ...dadosUsuario,
      toJSON: () => ({ ...dadosUsuario }),
      update: vi.fn(async (valores) => Object.assign(dadosUsuario, valores)),
    };
  };

  it("troca a senha pela nova, avisa por e-mail e não devolve o hash", async () => {
    const usuario = existente();
    Usuario.findByPk.mockImplementation(async (id) => (id === 1 ? { nome: "Helena Matos" } : usuario));

    const resultado = await usuarioService.reenviarSenha(7, 1);

    const { senha } = enviarSenhaGerada.mock.calls[0][0];
    const novoHash = usuario.update.mock.calls[0][0].senha_hash;

    expect(Usuario.findByPk).toHaveBeenCalledWith(7, { transaction: transacao, lock: "UPDATE" });
    expect(usuario.update).toHaveBeenCalledWith({ senha_hash: expect.any(String) }, { transaction: transacao });
    expect(await argon2.verify(novoHash, senha)).toBe(true);
    expect(enviarSenhaGerada).toHaveBeenCalledWith({
      para: "carla@exemplo.com",
      nome: "Carla Mendes",
      quemCadastrou: "Helena Matos",
      role: "gestor",
      senha,
      reenvio: true,
    });
    expect(resultado).toEqual({ id: 7, nome: "Carla Mendes", email: "carla@exemplo.com", role: "gestor" });
  });

  it("recusa cadastro não aprovado sem trocar a senha nem enviar e-mail", async () => {
    const usuario = existente();
    usuario.aprovado = false;
    Usuario.findByPk.mockImplementation(async (id) => (id === 1 ? { nome: "Helena Matos" } : usuario));

    await expect(usuarioService.reenviarSenha(7, 1)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Este cadastro não está aprovado. Aprove o usuário antes de reenviar a senha.",
    });
    expect(usuario.update).not.toHaveBeenCalled();
    expect(enviarSenhaGerada).not.toHaveBeenCalled();
  });

  it("devolve null sem enviar e-mail quando o usuário não existe", async () => {
    Usuario.findByPk.mockImplementation(async (id) => (id === 1 ? { nome: "Helena Matos" } : null));

    expect(await usuarioService.reenviarSenha(99, 1)).toBeNull();
    expect(enviarSenhaGerada).not.toHaveBeenCalled();
  });

  it("mantém a senha anterior e responde 503 quando o e-mail não sai", async () => {
    Usuario.findByPk.mockImplementation(async (id) => (id === 1 ? { nome: "Helena Matos" } : existente()));
    enviarSenhaGerada.mockRejectedValue(Object.assign(new Error("smtp"), { name: "EmailError" }));

    await expect(usuarioService.reenviarSenha(7, 1)).rejects.toMatchObject({
      statusCode: 503,
      message: "Não foi possível enviar o e-mail com a nova senha. A senha anterior continua valendo; tente novamente.",
    });
  });
});
