import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import Sequelize from "sequelize";
import pg from "pg";
import models from "../models/index.js";
import usuarioService from "../services/usuarioService.js";
import getUsuarioModel from "../models/usuario.js";

vi.mock("../models/index.js", () => ({
  default: {
    Usuario: {
      create: vi.fn(),
      findOne: vi.fn(),
      findAll: vi.fn(),
      findByPk: vi.fn(),
    },
  },
}));

const { Usuario } = models;

const criarUsuarioFalso = (dados) => {
  const usuario = { id: 1, ...dados };
  return {
    ...usuario,
    toJSON: () => ({ ...usuario }),
    update: vi.fn(async (novosDados) => Object.assign(usuario, novosDados)),
    destroy: vi.fn(),
  };
};

const sequelizeTeste = new Sequelize("postgres://teste:teste@localhost:5432/teste", {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
});
const UsuarioModelo = getUsuarioModel(sequelizeTeste, Sequelize);

const dadosValidos = {
  nome: "Bia",
  email: "bia@exemplo.com",
  senha_hash: "hash-qualquer",
  role: "fiscalizador",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cadastro de usuário", () => {
  it("cadastra com senha protegida e não devolve o hash", async () => {
    const dados = {
      nome: "Bia",
      email: "bia@exemplo.com",
      senha: "1234",
      role: "fiscalizador",
    };
    Usuario.findOne.mockResolvedValue(null);
    Usuario.create.mockImplementation(async (dadosCriacao) =>
      criarUsuarioFalso(dadosCriacao)
    );

    const resultado = await usuarioService.criar(dados);
    const dadosSalvos = Usuario.create.mock.calls[0][0];

    expect(Usuario.findOne).toHaveBeenCalledWith({
      where: { email: dados.email },
    });
    expect(dadosSalvos.senha_hash).not.toBe(dados.senha);
    expect(await bcrypt.compare(dados.senha, dadosSalvos.senha_hash)).toBe(true);
    expect(resultado).toEqual({
      id: 1,
      nome: dados.nome,
      email: dados.email,
      role: dados.role,
    });
    expect(resultado.senha_hash).toBeUndefined();
  });

  it("rejeita cadastro sem senha", async () => {
    await expect(
      usuarioService.criar({
        nome: "Bia",
        email: "bia@exemplo.com",
        role: "fiscalizador",
      })
    ).rejects.toThrow("A senha é obrigatória");

    expect(Usuario.findOne).not.toHaveBeenCalled();
    expect(Usuario.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro com email já existente", async () => {
    Usuario.findOne.mockResolvedValue(criarUsuarioFalso({ id: 2 }));

    await expect(
      usuarioService.criar({
        nome: "Bia",
        email: "bia@exemplo.com",
        senha: "1234",
        role: "fiscalizador",
      })
    ).rejects.toThrow("Email já cadastrado");

    expect(Usuario.create).not.toHaveBeenCalled();
  });
});

describe("validações do modelo Usuario", () => {
  it("aceita um usuário com todos os dados válidos", async () => {
    await expect(UsuarioModelo.build(dadosValidos).validate()).resolves.toBeDefined();
  });

  it("deve exigir nome", async () => {
    const { nome, ...semNome } = dadosValidos;
    await expect(UsuarioModelo.build(semNome).validate()).rejects.toThrow();
  });

  it("deve rejeitar nome vazio", async () => {
    await expect(
      UsuarioModelo.build({ ...dadosValidos, nome: "" }).validate()
    ).rejects.toThrow();
  });

  it("deve exigir email", async () => {
    const { email, ...semEmail } = dadosValidos;
    await expect(UsuarioModelo.build(semEmail).validate()).rejects.toThrow();
  });

  it("deve rejeitar email em formato inválido", async () => {
    await expect(
      UsuarioModelo.build({ ...dadosValidos, email: "nao-e-email" }).validate()
    ).rejects.toThrow();
  });

  it("deve exigir senha_hash", async () => {
    const { senha_hash, ...semSenha } = dadosValidos;
    await expect(UsuarioModelo.build(semSenha).validate()).rejects.toThrow();
  });

  it("deve aceitar apenas os papéis permitidos", async () => {
    for (const role of ["admin", "gestor", "fiscalizador"]) {
      await expect(
        UsuarioModelo.build({ ...dadosValidos, role }).validate()
      ).resolves.toBeDefined();
    }

    await expect(
      UsuarioModelo.build({ ...dadosValidos, role: "visitante" }).validate()
    ).rejects.toThrow("Role deve ser admin, gestor ou fiscalizador");
  });
});

describe("listar usuários", () => {
  it("deve retornar usuários sem senha_hash", async () => {
    const lista = [{ id: 1, nome: "Bia" }, { id: 2, nome: "Caio" }];
    Usuario.findAll.mockResolvedValue(lista);

    const resultado = await usuarioService.listar();

    expect(Usuario.findAll).toHaveBeenCalledWith({
      attributes: { exclude: ["senha_hash"] },
    });
    expect(resultado).toEqual(lista);
  });
});

describe("buscar usuário por id", () => {
  it("deve retornar o usuário encontrado", async () => {
    const usuario = { id: 1, nome: "Bia" };
    Usuario.findByPk.mockResolvedValue(usuario);

    const resultado = await usuarioService.buscarPorId(1);

    expect(Usuario.findByPk).toHaveBeenCalledWith(1, {
      attributes: { exclude: ["senha_hash"] },
    });
    expect(resultado).toEqual(usuario);
  });

  it("deve retornar null quando o usuário não existir", async () => {
    Usuario.findByPk.mockResolvedValue(null);

    expect(await usuarioService.buscarPorId(99)).toBeNull();
  });
});

describe("atualizar usuário", () => {
  it("deve atualizar os dados informados", async () => {
    const usuario = criarUsuarioFalso({ ...dadosValidos });
    Usuario.findByPk.mockResolvedValue(usuario);

    const resultado = await usuarioService.atualizar(1, {
      nome: "Beatriz",
      campoInexistente: "ignorado",
    });

    expect(usuario.update).toHaveBeenCalledWith({ nome: "Beatriz" });
    expect(resultado.nome).toBe("Beatriz");
    expect(resultado.senha_hash).toBeUndefined();
  });

  it("deve salvar a nova senha como hash", async () => {
    const usuario = criarUsuarioFalso({ ...dadosValidos });
    Usuario.findByPk.mockResolvedValue(usuario);

    await usuarioService.atualizar(1, { senha: "novaSenha" });
    const dadosSalvos = usuario.update.mock.calls[0][0];

    expect(dadosSalvos.senha).toBeUndefined();
    expect(dadosSalvos.senha_hash).not.toBe("novaSenha");
    expect(await bcrypt.compare("novaSenha", dadosSalvos.senha_hash)).toBe(true);
  });

  it("deve retornar null quando o usuário não existir", async () => {
    Usuario.findByPk.mockResolvedValue(null);

    expect(await usuarioService.atualizar(99, { nome: "X" })).toBeNull();
  });
});

describe("remover usuário", () => {
  it("deve remover o usuário encontrado", async () => {
    const usuario = criarUsuarioFalso({ ...dadosValidos });
    Usuario.findByPk.mockResolvedValue(usuario);

    const resultado = await usuarioService.remover(1);

    expect(usuario.destroy).toHaveBeenCalledTimes(1);
    expect(resultado.id).toBe(1);
    expect(resultado.senha_hash).toBeUndefined();
  });

  it("deve retornar null quando o usuário não existir", async () => {
    Usuario.findByPk.mockResolvedValue(null);

    expect(await usuarioService.remover(99)).toBeNull();
  });
});

describe("associações do modelo Usuario", () => {
  it("configura as associações com Visita e VisitaFiscalizador", () => {
    const modelsMock = {
      Visita: { name: "Visita" },
      VisitaFiscalizador: { name: "VisitaFiscalizador" },
    };

    const hasManySpy = vi.spyOn(UsuarioModelo, "hasMany").mockImplementation(() => {});
    const belongsToManySpy = vi.spyOn(UsuarioModelo, "belongsToMany").mockImplementation(() => {});

    UsuarioModelo.associate(modelsMock);

    expect(hasManySpy).toHaveBeenCalledWith(modelsMock.Visita, {
      foreignKey: "gestor_id",
      as: "visitasGerenciadas",
      onDelete: "RESTRICT",
    });

    expect(belongsToManySpy).toHaveBeenCalledWith(modelsMock.Visita, {
      through: modelsMock.VisitaFiscalizador,
      foreignKey: "fiscalizador_id",
      otherKey: "visita_id",
      as: "visitasFiscalizadas",
    });
  });
});