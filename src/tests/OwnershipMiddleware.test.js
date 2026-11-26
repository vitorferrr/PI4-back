import { beforeEach, describe, expect, it, vi } from "vitest";
import visitaService from "../services/visitaService.js";
import AppError from "../utils/appError.js";
import {
  verificarAcessoVisita,
  verificarGestorVisita,
} from "../middlewares/ownershipMiddleware.js";

vi.mock("../services/visitaService.js", () => ({
  default: { buscarParaAcesso: vi.fn() },
}));

// Visita 10: criada pelo gestor 1, com o fiscal 5.
const visita = { id: 10, status: "agendada", gestor_id: 1, fiscalizadores: [{ id: 5 }] };

const rodar = async (middleware, usuario) => {
  const req = { params: { id: "10" }, usuario };
  const next = vi.fn();

  await middleware(req, {}, next);

  return { req, next, erro: next.mock.calls[0][0] };
};

beforeEach(() => {
  vi.clearAllMocks();
  visitaService.buscarParaAcesso.mockResolvedValue(visita);
});

describe.each([
  ["verificarAcessoVisita", verificarAcessoVisita],
  ["verificarGestorVisita", verificarGestorVisita],
])("%s: casos comuns", (_, middleware) => {
  it("responde 401 sem usuário, sem ir no banco", async () => {
    const { erro } = await rodar(middleware, undefined);

    expect(erro).toBeInstanceOf(AppError);
    expect(erro.statusCode).toBe(401);
    expect(visitaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita não existe", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(null);

    const { erro } = await rodar(middleware, { id: 1, role: "admin" });

    expect(erro).toMatchObject({ statusCode: 404, message: "Visita não encontrada" });
    expect(visitaService.buscarParaAcesso).toHaveBeenCalledWith("10");
  });

  it("deixa o admin passar e guarda a visita em req.visita", async () => {
    const { req, next } = await rodar(middleware, { id: 99, role: "admin" });

    expect(next).toHaveBeenCalledWith();
    expect(req.visita).toBe(visita);
  });

  it("repassa para o errorHandler o erro do banco", async () => {
    const falha = new Error("conexão perdida");
    visitaService.buscarParaAcesso.mockRejectedValue(falha);

    const { erro } = await rodar(middleware, { id: 1, role: "admin" });

    expect(erro).toBe(falha);
  });
});

describe("verificarAcessoVisita (ver e trabalhar na visita)", () => {
  it.each([
    ["o fiscal da visita", { id: 5, role: "fiscalizador" }],
    ["o gestor que criou", { id: 1, role: "gestor" }],
    ["outro gestor", { id: 2, role: "gestor" }],
  ])("deixa %s passar", async (_, usuario) => {
    const { req, next } = await rodar(verificarAcessoVisita, usuario);

    expect(next).toHaveBeenCalledWith();
    expect(req.visita).toBe(visita);
  });

  it("responde 403 para o fiscal de outra visita", async () => {
    const { req, erro } = await rodar(verificarAcessoVisita, { id: 6, role: "fiscalizador" });

    expect(erro).toMatchObject({
      statusCode: 403,
      message: "Você não tem permissão para acessar esta visita.",
    });
    expect(req.visita).toBeUndefined();
  });
});

describe("verificarGestorVisita (editar, apagar e trocar o fiscal)", () => {
  it("deixa o gestor que criou a visita passar", async () => {
    const { req, next } = await rodar(verificarGestorVisita, { id: 1, role: "gestor" });

    expect(next).toHaveBeenCalledWith();
    expect(req.visita).toBe(visita);
  });

  it.each([
    ["outro gestor", { id: 2, role: "gestor" }],
    ["o próprio fiscal da visita", { id: 5, role: "fiscalizador" }],
  ])("responde 403 para %s", async (_, usuario) => {
    const { req, erro } = await rodar(verificarGestorVisita, usuario);

    expect(erro).toMatchObject({
      statusCode: 403,
      message: "Você não tem permissão para alterar uma visita de outro gestor.",
    });
    expect(req.visita).toBeUndefined();
  });
});
