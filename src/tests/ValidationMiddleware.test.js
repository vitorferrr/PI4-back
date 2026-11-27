import { beforeEach, describe, expect, it, vi } from "vitest";
import validate from "../middlewares/validate.js";
import errorHandler from "../middlewares/errorHandler.js";
import {
  atualizarRespostaSchema,
  atualizarUsuarioSchema,
  atualizarVisitaSchema,
  criarUsuarioSchema,
  criarVisitaSchema,
  listarUsuariosSchema,
  listarVisitasSchema,
  observacoesVisitaSchema,
  salvarRespostasSchema,
} from "../middlewares/validationSchemas.js";

// Roda o validate(schema) de verdade e, se ele recusar, passa o erro pelo
// errorHandler, como acontece numa rota do Express.
const comoMiddleware = (schema) => async (req, res, next) => {
  await validate(schema)(req, res, (erro) =>
    erro ? errorHandler(erro, req, res, next) : next()
  );
};

const validarCriacaoUsuario = comoMiddleware(criarUsuarioSchema);
const validarAtualizacaoUsuario = comoMiddleware(atualizarUsuarioSchema);
const validarListagemUsuarios = comoMiddleware(listarUsuariosSchema);
const validarCriacaoVisita = comoMiddleware(criarVisitaSchema);
const validarAtualizacaoVisita = comoMiddleware(atualizarVisitaSchema);
const validarListagemVisitas = comoMiddleware(listarVisitasSchema);
const validarAtualizacaoResposta = comoMiddleware(atualizarRespostaSchema);
const validarRespostasQuestionario = comoMiddleware(salvarRespostasSchema);
const validarObservacoesVisita = comoMiddleware(observacoesVisitaSchema);

const criarRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validarCriacaoUsuario", () => {
  it("chama next() quando todos os campos obrigatórios são válidos", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarCriacaoUsuario(
      {
        body: {
          nome: "Ana",
          email: "ana@procon.gov.br",
          role: "gestor",
        },
      },
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("retorna 400 com lista de erros quando faltam campos ou são inválidos", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarCriacaoUsuario(
      {
        body: {
          nome: "",
          email: "invalido",
          role: "visitante",
        },
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem:
        "O campo nome é obrigatório; Informe um email válido; Perfil (role) inválido",
    });
  });
});

describe("validarAtualizacaoUsuario", () => {
  it("rejeita corpo vazio", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarAtualizacaoUsuario({ body: {} }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("permite atualização parcial válida", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarAtualizacaoUsuario({ body: { nome: "Maria" } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita email inválido na atualização", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarAtualizacaoUsuario({ body: { email: "errado" } }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("validarCriacaoVisita", () => {
  it("chama next() para visita válida", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarCriacaoVisita(
      {
        body: {
          denunciado: "Loja Central",
          data_agendada: "2026-12-01T10:00:00Z",
          gestor_id: 2,
          fiscalizadores_ids: [3, 4],
        },
      },
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("retorna 400 para dados inválidos na criação de visita", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarCriacaoVisita(
      {
        body: {
          denunciado: "   ",
          data_agendada: "data-invalida",
          fiscalizadores_ids: [0, -1],
          latitude: 120,
          longitude: -200,
        },
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].mensagem.split("; ")).toHaveLength(5);
  });

  it("rejeita datas soltas ou inexistentes no calendário como '1', '2024' ou '2024-02-30'", async () => {
    for (const dataInvalida of ["1", "2024", "2024-02-30", "2023-02-29"]) {
      const res = criarRes();
      const next = vi.fn();

      await validarCriacaoVisita(
        { body: { denunciado: "Loja Central", data_agendada: dataInvalida } },
        res,
        next
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });
});

describe("validarAtualizacaoResposta", () => {
  it("aceita resposta preenchida", async () => {
    const next = vi.fn();

    await validarAtualizacaoResposta({ body: { resposta: "Sim" } }, criarRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([[{}], [{ resposta: "" }], [{ resposta: 1 }], [null], [["Sim"]]])(
    "rejeita corpo %j",
    async (body) => {
      const res = criarRes();
      const next = vi.fn();

      await validarAtualizacaoResposta({ body }, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    }
  );
});

describe("validarListagemUsuarios", () => {
  it.each([{}, { aprovado: "true" }, { aprovado: "false" }])("aceita %o", async (query) => {
    const next = vi.fn();

    await validarListagemUsuarios({ query }, criarRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([["sim"], ["1"], [["true", "false"]]])("rejeita aprovado = %o", async (aprovado) => {
    const res = criarRes();
    const next = vi.fn();

    await validarListagemUsuarios({ query: { aprovado } }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("validarListagemVisitas", () => {
  it("permite query vazia ou filtros válidos", async () => {
    const next = vi.fn();
    await validarListagemVisitas(
      { query: { status: "agendada", gestor_id: "1", fiscalizador_id: "2" } },
      criarRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita status ou ids inválidos na query", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarListagemVisitas(
      {
        query: {
          status: "inexistente",
          gestor_id: "abc",
          limit: "0",
          offset: "-1",
        },
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].mensagem.split("; ")).toHaveLength(4);
  });
});

describe("validarRespostasQuestionario", () => {
  it("chama next() para lista válida de respostas", async () => {
    const next = vi.fn();
    await validarRespostasQuestionario(
      {
        body: {
          respostas: [
            { pergunta_id: 1, resposta: "Sim" },
            { pergunta_id: 2, resposta: "Observação" },
          ],
        },
      },
      criarRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita lista vazia, pergunta duplicada ou resposta vazia", async () => {
    const res1 = criarRes();
    await validarRespostasQuestionario({ body: { respostas: [] } }, res1, vi.fn());
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = criarRes();
    await validarRespostasQuestionario(
      {
        body: {
          respostas: [
            { pergunta_id: 1, resposta: "Sim" },
            { pergunta_id: 1, resposta: "   " },
          ],
        },
      },
      res2,
      vi.fn()
    );
    expect(res2.status).toHaveBeenCalledWith(400);
  });
});

describe("validarObservacoesVisita", () => {
  it("aceita texto, texto vazio e null", async () => {
    for (const observacoes_livres of ["Produtos vencidos", "", null, "a".repeat(5000)]) {
      const res = criarRes();
      const next = vi.fn();

      await validarObservacoesVisita({ body: { observacoes_livres } }, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("conta o limite sem os espaços das pontas", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarObservacoesVisita({ body: { observacoes_livres: `  ${"a".repeat(5000)}  ` } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita campo ausente, tipo errado ou texto longo demais", async () => {
    const casos = [
      [{}, "observacoes_livres deve ser um texto ou null"],
      [{ observacoes_livres: 10 }, "observacoes_livres deve ser um texto ou null"],
      [{ observacoes_livres: ["texto"] }, "observacoes_livres deve ser um texto ou null"],
      [{ observacoes_livres: "a".repeat(5001) }, "observacoes_livres deve ter no máximo 5000 caracteres"],
    ];

    for (const [body, mensagem] of casos) {
      const res = criarRes();
      const next = vi.fn();

      await validarObservacoesVisita({ body }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].mensagem).toBe(mensagem);
    }
  });

  it("rejeita corpo que não é objeto", async () => {
    const res = criarRes();
    const next = vi.fn();

    await validarObservacoesVisita({ body: "texto" }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("validarAtualizacaoVisita", () => {
  it("permite atualização parcial válida e cancelamento", async () => {
    const next = vi.fn();
    await validarAtualizacaoVisita(
      { body: { denunciado: "Novo Local", status: "cancelada" } },
      criarRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejeita corpo vazio, data inválida ou status diferente de 'cancelada'", async () => {
    const res1 = criarRes();
    await validarAtualizacaoVisita({ body: {} }, res1, vi.fn());
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = criarRes();
    await validarAtualizacaoVisita(
      { body: { data_agendada: "amanhã", status: "concluida" } },
      res2,
      vi.fn()
    );
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(res2.json.mock.calls[0][0].mensagem.split("; ")).toHaveLength(2);
  });
});
