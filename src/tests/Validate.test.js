import { describe, expect, it, vi } from "vitest";
import express from "express";
import { z, ZodError } from "zod";
import validate from "../middlewares/validate.js";
import errorHandler from "../middlewares/errorHandler.js";

describe("validate (middleware de validação com Zod)", () => {
  it("troca req.body pelo dado validado e chama next() sem erro", async () => {
    const schema = z.object({
      body: z.object({ nome: z.string().trim() }),
    });
    const req = { body: { nome: "  Bia  ", extra: "descartado" }, params: {}, query: {} };
    const next = vi.fn();

    await validate(schema)(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ nome: "Bia" });
  });

  it("valida só params e preserva o body original", async () => {
    const schema = z.object({
      params: z.object({ id: z.coerce.number().int().positive() }),
    });
    const req = { body: { texto: "fica" }, params: { id: "10" }, query: {} };
    const next = vi.fn();

    await validate(schema)(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.params.id).toBe(10);
    expect(req.body).toEqual({ texto: "fica" });
  });

  it("encaminha o ZodError para next(erro) quando a validação falha", async () => {
    const schema = z.object({
      body: z.object({ idade: z.number("A idade deve ser um número") }),
    });
    const req = { body: { idade: "dez" }, params: {}, query: {} };
    const next = vi.fn();

    await validate(schema)(req, {}, next);

    const erro = next.mock.calls[0][0];
    expect(erro).toBeInstanceOf(ZodError);
    expect(erro.issues[0].path).toEqual(["body", "idade"]);
  });

  it("na rota de verdade (Express 5), troca req.query e responde 400 no formato do errorHandler", async () => {
    const schema = z.object({
      query: z.object({ limit: z.coerce.number("limit deve ser numérico").int().default(10) }),
    });
    const app = express();
    app.get("/teste", validate(schema), (req, res) => res.json(req.query));
    app.use(errorHandler);

    const servidor = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${servidor.address().port}/teste`;

    try {
      const ok = await fetch(base);
      expect(await ok.json()).toEqual({ limit: 10 });

      const ruim = await fetch(`${base}?limit=abc`);
      expect(ruim.status).toBe(400);
      expect(await ruim.json()).toEqual({
        mensagem: "limit deve ser numérico",
        erros: ["limit: limit deve ser numérico"],
      });
    } finally {
      await new Promise((resolve) => servidor.close(resolve));
    }
  });
});
