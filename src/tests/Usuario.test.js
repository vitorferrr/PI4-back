import { beforeEach, describe, expect, it, vi } from "vitest";
import argon2 from "argon2";
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
    expect(await argon2.verify(dadosSalvos.senha_hash, dados.senha)).toBe(true);
    expect(resultado).toEqual({
      id: 1,
      nome: dados.nome,
      email: dados.email,
      role: dados.role,
    });
    expect(resultado.senha_hash).toBeUndefined();
  });

  it("grava a matrícula do fiscalizador", async () => {
    Usuario.findOne.mockResolvedValue(null);
    Usuario.create.mockImplementation(async (dadosCriacao) =>
      criarUsuarioFalso(dadosCriacao)
    );

    const resultado = await usuarioService.criar({
      nome: "Bia",
      email: "bia@exemplo.com",
      senha: "1234",
      role: "fiscalizador",
      matricula: "12345-6",
    });

    expect(Usuario.create.mock.calls[0][0].matricula).toBe("12345-6");
    expect(resultado.matricula).toBe("12345-6");
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
    ).rejects.toMatchObject({ message: "Email já cadastrado", codigo: "EMAIL_CADASTRADO" });

    expect(Usuario.create).not.toHaveBeenCalled();
  });

  it("confere e grava o email sem espaços e em minúsculas", async () => {
    Usuario.findOne.mockResolvedValue(null);
    Usuario.create.mockImplementation(async (dados) => criarUsuarioFalso(dados));

    const resultado = await usuarioService.criar({
      nome: "Bia",
      email: " Bia@Exemplo.COM ",
      senha: "1234",
      role: "fiscalizador",
    });

    expect(Usuario.findOne).toHaveBeenCalledWith({ where: { email: "bia@exemplo.com" } });
    expect(Usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "bia@exemplo.com" }),
      { transaction: undefined }
    );
    expect(resultado.email).toBe("bia@exemplo.com");
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

  it("tem a matrícula como opcional", async () => {
    await expect(UsuarioModelo.build(dadosValidos).validate()).resolves.toBeDefined();
    expect(UsuarioModelo.getAttributes().matricula.allowNull).toBe(true);
  });

  it("grava matrícula vazia como null e remove espaços das pontas", () => {
    expect(UsuarioModelo.build({ ...dadosValidos, matricula: "   " }).matricula).toBeNull();
    expect(UsuarioModelo.build({ ...dadosValidos, matricula: " 12345-6 " }).matricula).toBe("12345-6");
  });

  it("limita a matrícula a 255 caracteres", async () => {
    await expect(
      UsuarioModelo.build({ ...dadosValidos, matricula: "1".repeat(256) }).validate()
    ).rejects.toThrow("Matrícula deve ter no máximo 255 caracteres");
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

  it.each([true, false])("filtra por aprovado = %s", async (aprovado) => {
    Usuario.findAll.mockResolvedValue([]);

    await usuarioService.listar({ aprovado });

    expect(Usuario.findAll).toHaveBeenCalledWith({
      where: { aprovado },
      attributes: { exclude: ["senha_hash"] },
    });
  });
});

describe("aprovar usuário", () => {
  it("marca o cadastro como aprovado e devolve sem a senha", async () => {
    const usuario = criarUsuarioFalso({ nome: "Ana", aprovado: false, senha_hash: "hash" });
    Usuario.findByPk.mockResolvedValue(usuario);

    const resultado = await usuarioService.aprovar(1);

    expect(usuario.update).toHaveBeenCalledWith({ aprovado: true });
    expect(resultado).toEqual({ id: 1, nome: "Ana", aprovado: true });
  });

  it("não grava de novo quem já está aprovado", async () => {
    const usuario = criarUsuarioFalso({ nome: "Ana", aprovado: true, senha_hash: "hash" });
    Usuario.findByPk.mockResolvedValue(usuario);

    await usuarioService.aprovar(1);

    expect(usuario.update).not.toHaveBeenCalled();
  });

  it("devolve null quando o usuário não existe", async () => {
    Usuario.findByPk.mockResolvedValue(null);

    expect(await usuarioService.aprovar(99)).toBeNull();
  });
});

describe("reprovar usuário", () => {
  it("bloqueia o fiscalizador sem apagar e devolve sem a senha", async () => {
    const usuario = criarUsuarioFalso({ nome: "Ana", role: "fiscalizador", aprovado: true, senha_hash: "hash" });
    Usuario.findByPk.mockResolvedValue(usuario);

    const resultado = await usuarioService.reprovar(1);

    expect(usuario.update).toHaveBeenCalledWith({ aprovado: false });
    expect(usuario.destroy).not.toHaveBeenCalled();
    expect(resultado).toEqual({ id: 1, nome: "Ana", role: "fiscalizador", aprovado: false });
  });

  it("não grava de novo quem já está reprovado", async () => {
    const usuario = criarUsuarioFalso({ role: "fiscalizador", aprovado: false, senha_hash: "hash" });
    Usuario.findByPk.mockResolvedValue(usuario);

    await usuarioService.reprovar(1);

    expect(usuario.update).not.toHaveBeenCalled();
  });

  it.each(["admin", "gestor"])("não reprova %s", async (role) => {
    const usuario = criarUsuarioFalso({ role, aprovado: true, senha_hash: "hash" });
    Usuario.findByPk.mockResolvedValue(usuario);

    await expect(usuarioService.reprovar(1)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Só cadastros de fiscalizador podem ser reprovados",
    });
    expect(usuario.update).not.toHaveBeenCalled();
  });

  it("devolve null quando o usuário não existe", async () => {
    Usuario.findByPk.mockResolvedValue(null);

    expect(await usuarioService.reprovar(99)).toBeNull();
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

  it("grava o email novo sem espaços e em minúsculas", async () => {
    const usuario = criarUsuarioFalso({ ...dadosValidos });
    Usuario.findByPk.mockResolvedValue(usuario);

    await usuarioService.atualizar(1, { email: " Nova@Exemplo.com" });

    expect(usuario.update).toHaveBeenCalledWith({ email: "nova@exemplo.com" });
  });

  it("deve atualizar a matrícula", async () => {
    const usuario = criarUsuarioFalso({ ...dadosValidos });
    Usuario.findByPk.mockResolvedValue(usuario);

    await usuarioService.atualizar(1, { matricula: "98765-4" });

    expect(usuario.update).toHaveBeenCalledWith({ matricula: "98765-4" });
  });

  it("deve salvar a nova senha como hash", async () => {
    const usuario = criarUsuarioFalso({ ...dadosValidos });
    Usuario.findByPk.mockResolvedValue(usuario);

    await usuarioService.atualizar(1, { senha: "novaSenha" });
    const dadosSalvos = usuario.update.mock.calls[0][0];

    expect(dadosSalvos.senha).toBeUndefined();
    expect(dadosSalvos.senha_hash).not.toBe("novaSenha");
    expect(await argon2.verify(dadosSalvos.senha_hash, "novaSenha")).toBe(true);
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