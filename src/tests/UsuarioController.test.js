import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import usuarioRoutes from "../routes/usuarioRoutes.js";
import usuarioService from "../services/usuarioService.js";

vi.mock("../services/usuarioService.js", () => ({
  default: {
    criar: vi.fn(),
    listar: vi.fn(),
    buscarPorId: vi.fn(),
    atualizar: vi.fn(),
    remover: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const usuarioFalso = { id: 1, nome: "Bia", email: "bia@exemplo.com", role: "fiscalizador" };

let servidor;
let urlBase;

const tokenDe = (role, id = 1) => jwt.sign({ id, role }, SEGREDO);

const requisitar = (metodo, caminho, role, corpo) =>
  fetch(`${urlBase}${caminho}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(role && { Authorization: `Bearer ${tokenDe(role)}` }),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/usuarios", usuarioRoutes);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  urlBase = `http://127.0.0.1:${servidor.address().port}/usuarios`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(usuarioService).forEach((metodo) => metodo.mockResolvedValue(usuarioFalso));
});

const rotas = [
  ["POST", "", "criar", ["admin"], ["gestor", "fiscalizador"]],
  ["GET", "", "listar", ["admin", "gestor"], ["fiscalizador"]],
  ["GET", "/1", "buscarPorId", ["admin"], ["gestor", "fiscalizador"]],
  ["PUT", "/1", "atualizar", ["admin"], ["gestor", "fiscalizador"]],
  ["DELETE", "/1", "remover", ["admin"], ["gestor", "fiscalizador"]],
];

describe.each(rotas)("%s /usuarios%s", (metodo, caminho, funcaoService, permitidos, bloqueados) => {
  const corpo = metodo === "POST" || metodo === "PUT" ? { nome: "Bia" } : undefined;

  it.each(permitidos)("permite acesso para %s", async (role) => {
    const resposta = await requisitar(metodo, caminho, role, corpo);

    expect(resposta.status).toBeLessThan(300);
    expect(usuarioService[funcaoService]).toHaveBeenCalledTimes(1);
  });

  it.each(bloqueados)("responde 403 para %s sem chamar o service", async (role) => {
    const resposta = await requisitar(metodo, caminho, role, corpo);

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      mensagem: "Usuário não possui permissão para acessar este recurso",
    });
    expect(usuarioService[funcaoService]).not.toHaveBeenCalled();
  });

  it("responde 401 sem token e não chama o service", async () => {
    const resposta = await requisitar(metodo, caminho, undefined, corpo);

    expect(resposta.status).toBe(401);
    expect(usuarioService[funcaoService]).not.toHaveBeenCalled();
  });
});

describe("POST /usuarios (respostas do controller)", () => {
  const novoUsuario = { nome: "Bia", email: "bia@exemplo.com", senha: "123456", role: "fiscalizador" };

  const criarErro = (name, extras = {}) =>
    Object.assign(new Error("erro do service"), { name, ...extras });

  it("responde 201 com o usuário criado e repassa o corpo ao service", async () => {
    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.criar).toHaveBeenCalledWith(novoUsuario);
  });

  it("responde 409 quando o banco acusa email duplicado", async () => {
    usuarioService.criar.mockRejectedValue(criarErro("SequelizeUniqueConstraintError"));

    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({ mensagem: "Email já cadastrado" });
  });

  it("responde 400 quando o service rejeita os dados", async () => {
    usuarioService.criar.mockRejectedValue(
      Object.assign(new Error("A senha é obrigatória"), { name: "ValidacaoError" })
    );

    const resposta = await requisitar("POST", "", "admin", { ...novoUsuario, senha: undefined });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao criar usuário",
      erros: ["A senha é obrigatória"],
    });
  });

  it("responde 400 com a lista de erros de validação do Sequelize", async () => {
    usuarioService.criar.mockRejectedValue(
      criarErro("SequelizeValidationError", {
        errors: [{ message: "email inválido" }, { message: "Role deve ser admin, gestor ou fiscalizador" }],
      })
    );

    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao criar usuário",
      erros: ["email inválido", "Role deve ser admin, gestor ou fiscalizador"],
    });
  });
});

describe("GET /usuarios (respostas do controller)", () => {
  it("responde 200 com a lista do service", async () => {
    usuarioService.listar.mockResolvedValue([usuarioFalso]);

    const resposta = await requisitar("GET", "", "gestor");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([usuarioFalso]);
  });
});

describe("GET /usuarios/:id (respostas do controller)", () => {
  it("responde 200 com o usuário e repassa o id ao service", async () => {
    const resposta = await requisitar("GET", "/1", "admin");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.buscarPorId).toHaveBeenCalledWith("1");
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.buscarPorId.mockResolvedValue(null);

    const resposta = await requisitar("GET", "/99", "admin");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });
});

describe("PUT /usuarios/:id (respostas do controller)", () => {
  it("responde 200 com o usuário atualizado e repassa id e corpo ao service", async () => {
    const resposta = await requisitar("PUT", "/1", "admin", { nome: "Beatriz" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.atualizar).toHaveBeenCalledWith("1", { nome: "Beatriz" });
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.atualizar.mockResolvedValue(null);

    const resposta = await requisitar("PUT", "/99", "admin", { nome: "Beatriz" });

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });

  it("responde 409 ao trocar para um email que já existe", async () => {
    usuarioService.atualizar.mockRejectedValue(
      Object.assign(new Error("duplicado"), { name: "SequelizeUniqueConstraintError" })
    );

    const resposta = await requisitar("PUT", "/1", "admin", { email: "outro@exemplo.com" });

    expect(resposta.status).toBe(409);
  });
});

describe("DELETE /usuarios/:id (respostas do controller)", () => {
  it("responde 200 com o usuário removido e repassa o id ao service", async () => {
    const resposta = await requisitar("DELETE", "/1", "admin");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.remover).toHaveBeenCalledWith("1");
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.remover.mockResolvedValue(null);

    const resposta = await requisitar("DELETE", "/99", "admin");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });
});

describe.each([
  ["POST", "", "criar", "Erro ao criar usuário"],
  ["GET", "", "listar", "Erro ao listar usuários"],
  ["GET", "/1", "buscarPorId", "Erro ao buscar usuário"],
  ["PUT", "/1", "atualizar", "Erro ao atualizar usuário"],
  ["DELETE", "/1", "remover", "Erro ao apagar usuário"],
])("erro inesperado em %s /usuarios%s", (metodo, caminho, funcaoService, mensagem) => {
  it("responde 500 sem expor o erro interno", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    usuarioService[funcaoService].mockRejectedValue(new Error("falha no banco"));
    const corpo = metodo === "POST" || metodo === "PUT" ? { nome: "Bia" } : undefined;

    const resposta = await requisitar(metodo, caminho, "admin", corpo);

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ mensagem });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
