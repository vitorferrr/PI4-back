import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import authRoutes from "../routes/authRoutes.js";
import usuarioService from "../services/usuarioService.js";

vi.mock("../models/index.js", () => {
  const revogados = new Set();
  return {
    default: {
      Usuario: { findOne: vi.fn() },
      TokenRevogado: {
        findOne: vi.fn(async ({ where }) => (revogados.has(where.jti) ? { id: 1 } : null)),
        bulkCreate: vi.fn(async (linhas) => linhas.forEach(({ jti }) => revogados.add(jti))),
        destroy: vi.fn(async () => 0),
      },
    },
  };
});
vi.mock("../services/usuarioService.js", () => ({ default: { criar: vi.fn() } }));

const SEGREDO = "segredo-de-teste";
const cadastro = { nome: "Ana", email: "ana@exemplo.com", senha: "senha-forte" };
const usuarioCriado = {
  id: 9,
  nome: "Ana",
  email: "ana@exemplo.com",
  role: "fiscalizador",
  matricula: null,
  aprovado: false,
};

const novaSessao = () =>
  jwt.sign({ id: 9, role: "fiscalizador" }, SEGREDO, { expiresIn: "1h", jwtid: randomUUID() });

let servidor;
let urlBase;

const requisitar = (caminho, corpo, token) =>
  fetch(`${urlBase}${caminho}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

const erroDoService = (name, dados = {}) => Object.assign(new Error("x"), { name, ...dados });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  urlBase = `http://127.0.0.1:${servidor.address().port}/auth`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  usuarioService.criar.mockResolvedValue(usuarioCriado);
});

describe("POST /auth/signup", () => {
  it("cria um fiscalizador pendente de aprovação e não devolve token", async () => {
    const resposta = await requisitar("/signup", cadastro);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(201);
    expect(corpo).toEqual({
      mensagem: "Cadastro recebido. Aguarde a aprovação de um administrador para entrar.",
      usuario: { id: 9, nome: "Ana", email: "ana@exemplo.com", role: "fiscalizador", aprovado: false },
    });
    expect(corpo.token).toBeUndefined();
  });

  it.each(["admin", "gestor"])("ignora role %s no corpo e cria fiscalizador", async (role) => {
    await requisitar("/signup", { ...cadastro, role });

    expect(usuarioService.criar).toHaveBeenCalledWith(
      expect.objectContaining({ role: "fiscalizador" })
    );
  });

  it("repassa a matrícula e limpa espaços do nome e do email", async () => {
    await requisitar("/signup", { ...cadastro, nome: " Ana ", email: " ana@exemplo.com ", matricula: "123" });

    expect(usuarioService.criar).toHaveBeenCalledWith({
      nome: "Ana",
      email: "ana@exemplo.com",
      senha: "senha-forte",
      matricula: "123",
      role: "fiscalizador",
      aprovado: false,
    });
  });

  it.each([
    [{ email: "ana@exemplo.com", senha: "senha-forte" }],
    [{ nome: "Ana", senha: "senha-forte" }],
    [{ nome: "Ana", email: "ana@exemplo.com" }],
    [{ nome: "   ", email: "ana@exemplo.com", senha: "senha-forte" }],
    [{ nome: 10, email: "ana@exemplo.com", senha: "senha-forte" }],
    [undefined],
  ])("responde 400 quando falta nome, email ou senha (%#)", async (corpo) => {
    const resposta = await requisitar("/signup", corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao realizar cadastro",
      erros: ["Nome, email e senha são obrigatórios"],
    });
    expect(usuarioService.criar).not.toHaveBeenCalled();
  });

  it.each(["1234567", "a".repeat(73), "é".repeat(37)])(
    "responde 400 para senha fora do tamanho (%#)",
    async (senha) => {
      const resposta = await requisitar("/signup", { ...cadastro, senha });

      expect(resposta.status).toBe(400);
      expect((await resposta.json()).erros).toEqual(["A senha deve ter entre 8 e 72 caracteres"]);
      expect(usuarioService.criar).not.toHaveBeenCalled();
    }
  );

  it("aceita senha com exatamente 8 caracteres", async () => {
    expect((await requisitar("/signup", { ...cadastro, senha: "12345678" })).status).toBe(201);
  });

  it("responde 400 para matrícula que não é texto", async () => {
    const resposta = await requisitar("/signup", { ...cadastro, matricula: 123 });

    expect(resposta.status).toBe(400);
    expect(usuarioService.criar).not.toHaveBeenCalled();
  });

  it("responde 409 para email já cadastrado", async () => {
    usuarioService.criar.mockRejectedValue(
      erroDoService("ValidacaoError", { message: "Email já cadastrado", codigo: "EMAIL_CADASTRADO" })
    );

    const resposta = await requisitar("/signup", cadastro);

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({ mensagem: "Email já cadastrado" });
  });

  it("responde 409 quando o banco barra o email repetido em cadastros simultâneos", async () => {
    usuarioService.criar.mockRejectedValue(erroDoService("SequelizeUniqueConstraintError"));

    expect((await requisitar("/signup", cadastro)).status).toBe(409);
  });

  it("responde 400 quando o model rejeita o email", async () => {
    usuarioService.criar.mockRejectedValue(
      erroDoService("SequelizeValidationError", { errors: [{ message: "Validation isEmail on email failed" }] })
    );

    const resposta = await requisitar("/signup", { ...cadastro, email: "ana" });

    expect(resposta.status).toBe(400);
  });

  it("responde 500 em erro inesperado", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    usuarioService.criar.mockRejectedValue(new Error("banco fora"));

    const resposta = await requisitar("/signup", cadastro);

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ mensagem: "Erro ao realizar cadastro" });
    consoleError.mockRestore();
  });
});

describe("POST /auth/logout", () => {
  it("encerra a sessão: o mesmo token passa a receber 401", async () => {
    const token = novaSessao();

    const saida = await requisitar("/logout", undefined, token);
    const repeticao = await requisitar("/logout", undefined, token);

    expect(saida.status).toBe(204);
    expect(repeticao.status).toBe(401);
    expect(await repeticao.json()).toEqual({ mensagem: "Sessão encerrada" });
  });

  it("não encerra outra sessão do mesmo usuário", async () => {
    const primeira = novaSessao();
    const segunda = novaSessao();

    await requisitar("/logout", undefined, primeira);

    expect((await requisitar("/logout", undefined, segunda)).status).toBe(204);
  });

  it("exige token", async () => {
    expect((await requisitar("/logout")).status).toBe(401);
  });
});
