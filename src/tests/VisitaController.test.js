import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import visitaRoutes from "../routes/visitaRoutes.js";
import visitaService from "../services/visitaService.js";

vi.mock("../services/visitaService.js", () => ({
  default: {
    criar: vi.fn(),
    listar: vi.fn(),
    buscarPorId: vi.fn(),
    iniciar: vi.fn(),
    concluir: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const visitaDoFiscalizador5 = { id: 10, fiscalizadores: [{ id: 5 }] };

let servidor;
let urlBase;

const tokenDe = (role, id = 5) => jwt.sign({ id, role }, SEGREDO);

const requisitar = (metodo, caminho, role = "fiscalizador", id = 5) =>
  fetch(`${urlBase}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokenDe(role, id)}` },
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use("/visitas", visitaRoutes);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  urlBase = `http://127.0.0.1:${servidor.address().port}/visitas`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /visitas/:id", () => {
  it("retorna a visita para o fiscalizador associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);

    const resposta = await requisitar("GET", "/10");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(visitaDoFiscalizador5);
  });

  it("responde 404 para fiscalizador não associado, como em visita inexistente", async () => {
    visitaService.buscarPorId.mockResolvedValueOnce(visitaDoFiscalizador5);
    const naoAssociado = await requisitar("GET", "/10", "fiscalizador", 6);

    visitaService.buscarPorId.mockResolvedValueOnce(null);
    const inexistente = await requisitar("GET", "/99");

    expect(naoAssociado.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(await naoAssociado.json()).toEqual(await inexistente.json());
  });

  it.each(["admin", "gestor"])("permite que %s acesse sem estar associado", async (role) => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);

    const resposta = await requisitar("GET", "/10", role, 1);

    expect(resposta.status).toBe(200);
  });

  it.each(["abc", "1.5", "-1", "0", "1e3", "2147483648"])(
    "responde 400 para o id %s sem consultar o service",
    async (id) => {
      const resposta = await requisitar("GET", `/${id}`);

      expect(resposta.status).toBe(400);
      expect(visitaService.buscarPorId).not.toHaveBeenCalled();
    }
  );

  it("exige autenticação antes de validar o id", async () => {
    const resposta = await fetch(`${urlBase}/abc`);

    expect(resposta.status).toBe(401);
  });
});

describe("GET /visitas", () => {
  it("restringe o fiscalizador às próprias visitas", async () => {
    visitaService.listar.mockResolvedValue([visitaDoFiscalizador5]);

    const resposta = await requisitar("GET", "");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([visitaDoFiscalizador5]);
    expect(visitaService.listar).toHaveBeenCalledWith({
      status: undefined,
      gestor_id: undefined,
      fiscalizador_id: 5,
    });
  });

  it("ignora o fiscalizador_id da query quando quem pede é fiscalizador", async () => {
    visitaService.listar.mockResolvedValue([]);

    await requisitar("GET", "?fiscalizador_id=6&status=agendada");

    expect(visitaService.listar).toHaveBeenCalledWith({
      status: "agendada",
      gestor_id: undefined,
      fiscalizador_id: 5,
    });
  });

  it.each(["admin", "gestor"])("repassa os filtros da query sem alteração para %s", async (role) => {
    visitaService.listar.mockResolvedValue([]);

    const resposta = await requisitar(
      "GET",
      "?status=concluida&gestor_id=2&fiscalizador_id=6",
      role,
      1
    );

    expect(resposta.status).toBe(200);
    expect(visitaService.listar).toHaveBeenCalledWith({
      status: "concluida",
      gestor_id: "2",
      fiscalizador_id: "6",
    });
  });

  it.each(["admin", "gestor"])("lista sem filtros para %s quando a query está vazia", async (role) => {
    visitaService.listar.mockResolvedValue([]);

    await requisitar("GET", "", role, 1);

    expect(visitaService.listar).toHaveBeenCalledWith({
      status: undefined,
      gestor_id: undefined,
      fiscalizador_id: undefined,
    });
  });

  it("exige autenticação", async () => {
    const resposta = await fetch(urlBase);

    expect(resposta.status).toBe(401);
    expect(visitaService.listar).not.toHaveBeenCalled();
  });
});

describe.each([
  ["iniciar", "Erro ao iniciar visita"],
  ["concluir", "Erro ao concluir visita"],
])("PATCH /visitas/:id/%s", (acao, mensagemErro) => {
  it("aplica a transição para o fiscalizador associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService[acao].mockResolvedValue({ id: 10 });

    const resposta = await requisitar("PATCH", `/10/${acao}`);

    expect(resposta.status).toBe(200);
    expect(visitaService[acao]).toHaveBeenCalledWith("10");
  });

  it("responde 404 e não altera a visita para fiscalizador não associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);

    const resposta = await requisitar("PATCH", `/10/${acao}`, "fiscalizador", 6);

    expect(resposta.status).toBe(404);
    expect(visitaService[acao]).not.toHaveBeenCalled();
  });

  it("permite que gestor aplique a transição sem estar associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService[acao].mockResolvedValue({ id: 10 });

    const resposta = await requisitar("PATCH", `/10/${acao}`, "gestor", 1);

    expect(resposta.status).toBe(200);
  });

  it("responde 404 quando a visita não existe", async () => {
    visitaService.buscarPorId.mockResolvedValue(null);

    const resposta = await requisitar("PATCH", `/99/${acao}`);

    expect(resposta.status).toBe(404);
    expect(visitaService[acao]).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita é removida durante a transição", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService[acao].mockResolvedValue(null);

    const resposta = await requisitar("PATCH", `/10/${acao}`);

    expect(resposta.status).toBe(404);
  });

  it("responde 400 quando o status atual não permite a transição", async () => {
    const erro = new Error("transição inválida");
    erro.name = "ValidacaoError";
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService[acao].mockRejectedValue(erro);

    const resposta = await requisitar("PATCH", `/10/${acao}`);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: mensagemErro,
      erros: ["transição inválida"],
    });
  });

  it("responde 400 para id não numérico", async () => {
    const resposta = await requisitar("PATCH", `/abc/${acao}`);

    expect(resposta.status).toBe(400);
    expect(visitaService.buscarPorId).not.toHaveBeenCalled();
  });

  it("não aceita mais PUT", async () => {
    const resposta = await requisitar("PUT", `/10/${acao}`);

    expect(resposta.status).toBe(404);
    expect(visitaService[acao]).not.toHaveBeenCalled();
  });
});

describe("erros inesperados", () => {
  it("responde 500 quando o service falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    visitaService.buscarPorId.mockRejectedValue(new Error("falha no banco"));

    const resposta = await requisitar("GET", "/10");

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ mensagem: "Erro ao buscar visita" });
    consoleError.mockRestore();
  });
});
