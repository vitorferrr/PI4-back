import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import visitaRoutes from "../routes/visitaRoutes.js";
import visitaService from "../services/visitaService.js";
import errorHandler from "../middlewares/errorHandler.js";

vi.mock("../services/authService.js", () => ({ default: { tokenRevogado: vi.fn(async () => false) } }));
vi.mock("../services/visitaService.js", () => ({
  default: {
    criar: vi.fn(),
    listar: vi.fn(),
    buscarPorId: vi.fn(),
    buscarParaAcesso: vi.fn(),
    atualizar: vi.fn(),
    remover: vi.fn(),
    iniciar: vi.fn(),
    concluir: vi.fn(),
    salvarObservacoes: vi.fn(),
    listarFiscalizadores: vi.fn(),
    adicionarFiscalizador: vi.fn(),
    substituirFiscalizadores: vi.fn(),
    removerFiscalizador: vi.fn(),
  },
}));

vi.mock("../services/documentoService.js", () => ({
  default: {
    gerar: vi.fn(),
  },
}));

vi.mock("../services/questionarioService.js", () => ({
  default: {
    listar: vi.fn(),
    salvarRespostas: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const visitaDoFiscalizador5 = { id: 10, fiscalizadores: [{ id: 5 }] };

let servidor;
let urlBase;

const tokenDe = (role, id = 5) => jwt.sign({ id, role }, SEGREDO);

const requisitar = (metodo, caminho, role = "fiscalizador", id = 5, corpo) =>
  fetch(`${urlBase}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${tokenDe(role, id)}`,
      "Content-Type": "application/json",
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/visitas", visitaRoutes);
  app.use(errorHandler);

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
  // O ownershipMiddleware usa a busca leve (buscarParaAcesso). Por padrão ela
  // devolve a mesma visita que cada teste configurou na busca completa.
  visitaService.buscarParaAcesso.mockImplementation((id) => visitaService.buscarPorId(id));
});

describe("GET /visitas/:id", () => {
  it("retorna a visita para o fiscalizador associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);

    const resposta = await requisitar("GET", "/10");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(visitaDoFiscalizador5);
  });

  it("responde 403 para fiscalizador não associado e 404 para visita inexistente", async () => {
    visitaService.buscarPorId.mockResolvedValueOnce(visitaDoFiscalizador5);
    const naoAssociado = await requisitar("GET", "/10", "fiscalizador", 6);

    visitaService.buscarPorId.mockResolvedValueOnce(null);
    const inexistente = await requisitar("GET", "/99");

    expect(naoAssociado.status).toBe(403);
    expect(await naoAssociado.json()).toEqual({ mensagem: "Você não tem permissão para acessar esta visita." });
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual({ mensagem: "Visita não encontrada" });
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

describe("POST /visitas", () => {
  const dadosVisita = {
    denunciado: "Mercado Bom Preço",
    data_agendada: "2026-12-01T10:00:00Z",
  };

  const criarErro = (name, extras = {}) =>
    Object.assign(new Error("erro do service"), { name, ...extras });

  it("cria a visita, responde 201 e usa o gestor logado quando gestor_id não é enviado", async () => {
    const visitaCriada = { id: 10, ...dadosVisita, gestor_id: 1 };
    visitaService.criar.mockResolvedValue(visitaCriada);

    const resposta = await requisitar("POST", "", "gestor", 1, dadosVisita);

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual(visitaCriada);
    expect(visitaService.criar).toHaveBeenCalledWith({ ...dadosVisita, gestor_id: 1 }, []);
  });

  it("mantém o gestor_id enviado no corpo", async () => {
    visitaService.criar.mockResolvedValue({ id: 10 });

    await requisitar("POST", "", "admin", 1, { ...dadosVisita, gestor_id: 2 });

    expect(visitaService.criar).toHaveBeenCalledWith({ ...dadosVisita, gestor_id: 2 }, []);
  });

  it("repassa fiscalizadores_ids separados dos dados da visita", async () => {
    visitaService.criar.mockResolvedValue({ id: 10 });

    await requisitar("POST", "", "gestor", 1, { ...dadosVisita, fiscalizadores_ids: [5, 6] });

    expect(visitaService.criar).toHaveBeenCalledWith({ ...dadosVisita, gestor_id: 1 }, [5, 6]);
  });

  it("aceita o campo fiscalizadores como alternativa a fiscalizadores_ids", async () => {
    visitaService.criar.mockResolvedValue({ id: 10 });

    await requisitar("POST", "", "gestor", 1, { ...dadosVisita, fiscalizadores: [7] });

    expect(visitaService.criar).toHaveBeenCalledWith({ ...dadosVisita, gestor_id: 1 }, [7]);
  });

  it("da preferência a fiscalizadores_ids quando os dois campos são enviados", async () => {
    visitaService.criar.mockResolvedValue({ id: 10 });

    await requisitar("POST", "", "gestor", 1, {
      ...dadosVisita,
      fiscalizadores_ids: [5],
      fiscalizadores: [7],
    });

    expect(visitaService.criar).toHaveBeenCalledWith({ ...dadosVisita, gestor_id: 1 }, [5]);
  });

  it("responde 403 para fiscalizador sem chamar o service", async () => {
    const resposta = await requisitar("POST", "", "fiscalizador", 5, dadosVisita);

    expect(resposta.status).toBe(403);
    expect(visitaService.criar).not.toHaveBeenCalled();
  });

  it("responde 400 quando o service rejeita os dados", async () => {
    visitaService.criar.mockRejectedValue(criarErro("ValidacaoError"));

    const resposta = await requisitar("POST", "", "gestor", 1, dadosVisita);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "erro do service",
    });
  });

  it("responde 400 com a lista de erros de validação do Sequelize", async () => {
    visitaService.criar.mockRejectedValue(
      criarErro("SequelizeValidationError", {
        errors: [{ message: "denunciado vazio" }, { message: "data inválida" }],
      })
    );

    const resposta = await requisitar("POST", "", "gestor", 1, dadosVisita);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "denunciado vazio, data inválida",
    });
  });

  it("responde 400 quando o gestor ou fiscalizador informado não existe", async () => {
    visitaService.criar.mockRejectedValue(criarErro("SequelizeForeignKeyConstraintError"));

    const resposta = await requisitar("POST", "", "gestor", 1, {
      ...dadosVisita,
      fiscalizadores_ids: [999],
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Gestor ou fiscalizador informado não existe no sistema.",
    });
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

// O iniciar exige a localização do fiscal (iniciarVisitaSchema); o concluir não tem corpo.
describe.each([
  ["iniciar", { latitude: -8.1127, longitude: -35.0147 }],
  ["concluir", undefined],
])("PATCH /visitas/:id/%s", (acao, corpo) => {
  it("aplica a transição para o fiscalizador associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService[acao].mockResolvedValue({ id: 10 });

    const resposta = await requisitar("PATCH", `/10/${acao}`, "fiscalizador", 5, corpo);

    expect(resposta.status).toBe(200);
    expect(visitaService[acao].mock.calls[0][0]).toBe("10");
  });

  it("responde 403 e não altera a visita para fiscalizador não associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);

    const resposta = await requisitar("PATCH", `/10/${acao}`, "fiscalizador", 6, corpo);

    expect(resposta.status).toBe(403);
    expect(visitaService[acao]).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita não existe", async () => {
    visitaService.buscarPorId.mockResolvedValue(null);

    const resposta = await requisitar("PATCH", `/99/${acao}`, "fiscalizador", 5, corpo);

    expect(resposta.status).toBe(404);
    expect(visitaService[acao]).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita é removida durante a transição", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService[acao].mockResolvedValue(null);

    const resposta = await requisitar("PATCH", `/10/${acao}`, "fiscalizador", 5, corpo);

    expect(resposta.status).toBe(404);
  });

  it("responde 400 quando o status atual não permite a transição", async () => {
    const erro = new Error("transição inválida");
    erro.name = "ValidacaoError";
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService[acao].mockRejectedValue(erro);

    const resposta = await requisitar("PATCH", `/10/${acao}`, "fiscalizador", 5, corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "transição inválida",
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

describe("perfis que podem iniciar e concluir", () => {
  it("permite que gestor conclua a visita sem estar associado", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService.concluir.mockResolvedValue({ id: 10 });

    const resposta = await requisitar("PATCH", "/10/concluir", "gestor", 1);

    expect(resposta.status).toBe(200);
  });

  it.each(["gestor", "admin"])("responde 403 quando %s tenta iniciar a visita", async (role) => {
    const resposta = await requisitar("PATCH", "/10/iniciar", role, 1, {
      latitude: -8.1,
      longitude: -35,
    });

    expect(resposta.status).toBe(403);
    expect(visitaService.iniciar).not.toHaveBeenCalled();
  });
});

describe("PATCH /visitas/:id/iniciar com localização", () => {
  it("repassa a latitude e a longitude do corpo para o service", async () => {
    const coordenadas = { latitude: -8.1127, longitude: -35.0147 };
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService.iniciar.mockResolvedValue({ id: 10, ...coordenadas });

    const resposta = await requisitar("PATCH", "/10/iniciar", "fiscalizador", 5, coordenadas);

    expect(resposta.status).toBe(200);
    expect(visitaService.iniciar).toHaveBeenCalledWith("10", coordenadas);
  });

  it("responde 400 pelo schema quando a localização é inválida, sem chamar o service", async () => {
    const resposta = await requisitar("PATCH", "/10/iniciar", "fiscalizador", 5, {
      latitude: 200,
      longitude: -35,
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "A latitude deve ser um número entre -90 e 90",
    });
    expect(visitaService.buscarPorId).not.toHaveBeenCalled();
    expect(visitaService.iniciar).not.toHaveBeenCalled();
  });

  it("responde 400 quando a localização não é enviada", async () => {
    const resposta = await requisitar("PATCH", "/10/iniciar", "fiscalizador", 5, {});

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem:
        "A latitude deve ser um número entre -90 e 90; A longitude deve ser um número entre -180 e 180",
    });
  });
});

describe("erros inesperados", () => {
  it("responde 500 quando o service falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    visitaService.buscarPorId.mockRejectedValue(new Error("falha no banco"));

    const resposta = await requisitar("GET", "/10");

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ mensagem: "Erro interno do servidor" });
    consoleError.mockRestore();
  });
});

describe("PATCH /visitas/:id/observacoes", () => {
  const visitaParaAcesso = { id: 10, status: "em_andamento", fiscalizadores: [{ id: 5 }] };

  it("salva as observações para o fiscalizador da visita e devolve a visita", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaParaAcesso);
    visitaService.salvarObservacoes.mockResolvedValue({ id: 10, observacoes_livres: "Texto" });

    const resposta = await requisitar("PATCH", "/10/observacoes", "fiscalizador", 5, {
      observacoes_livres: "Texto",
    });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ id: 10, observacoes_livres: "Texto" });
    expect(visitaService.salvarObservacoes).toHaveBeenCalledWith(10, "Texto");
  });

  it("aceita null para apagar as observações", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaParaAcesso);
    visitaService.salvarObservacoes.mockResolvedValue({ id: 10, observacoes_livres: null });

    const resposta = await requisitar("PATCH", "/10/observacoes", "fiscalizador", 5, {
      observacoes_livres: null,
    });

    expect(resposta.status).toBe(200);
    expect(visitaService.salvarObservacoes).toHaveBeenCalledWith(10, null);
  });

  it("responde 403 para fiscalizador que não é da visita, sem gravar", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaParaAcesso);

    const resposta = await requisitar("PATCH", "/10/observacoes", "fiscalizador", 6, {
      observacoes_livres: "Texto",
    });

    expect(resposta.status).toBe(403);
    expect(visitaService.salvarObservacoes).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita não existe", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(null);

    const resposta = await requisitar("PATCH", "/99/observacoes", "fiscalizador", 5, {
      observacoes_livres: "Texto",
    });

    expect(resposta.status).toBe(404);
  });

  it("responde 404 quando a visita some durante a gravação", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaParaAcesso);
    visitaService.salvarObservacoes.mockResolvedValue(null);

    const resposta = await requisitar("PATCH", "/10/observacoes", "fiscalizador", 5, {
      observacoes_livres: "Texto",
    });

    expect(resposta.status).toBe(404);
  });

  it("responde 403 para gestor e admin, que não registram observações pelo app", async () => {
    for (const role of ["gestor", "admin"]) {
      const resposta = await requisitar("PATCH", "/10/observacoes", role, 1, {
        observacoes_livres: "Texto",
      });

      expect(resposta.status).toBe(403);
    }
    expect(visitaService.salvarObservacoes).not.toHaveBeenCalled();
  });

  it("responde 400 quando o corpo é inválido, sem chamar o service", async () => {
    for (const corpo of [{}, { observacoes_livres: 123 }, { observacoes_livres: "a".repeat(5001) }]) {
      const resposta = await requisitar("PATCH", "/10/observacoes", "fiscalizador", 5, corpo);

      expect(resposta.status).toBe(400);
    }
    expect(visitaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 400 com a mensagem do service quando o documento já foi gerado", async () => {
    const erro = new Error(
      "O documento da visita já foi gerado; as observações não podem mais ser alteradas"
    );
    erro.name = "ValidacaoError";
    erro.errors = [{ message: erro.message }];
    visitaService.buscarParaAcesso.mockResolvedValue(visitaParaAcesso);
    visitaService.salvarObservacoes.mockRejectedValue(erro);

    const resposta = await requisitar("PATCH", "/10/observacoes", "fiscalizador", 5, {
      observacoes_livres: "Texto",
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: erro.message,
    });
  });
});

describe("PUT /visitas/:id", () => {
  it("atualiza a visita para o gestor dono e retorna 200", async () => {
    const visitaAtualizada = { id: 10, gestor_id: 1, denunciado: "Novo Nome" };
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 1 });
    visitaService.atualizar.mockResolvedValue(visitaAtualizada);

    const resposta = await requisitar("PUT", "/10", "gestor", 1, {
      denunciado: "Novo Nome",
      fiscalizadores_ids: [5],
    });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(visitaAtualizada);
    expect(visitaService.atualizar).toHaveBeenCalledWith(
      "10",
      { denunciado: "Novo Nome" },
      [5]
    );
  });

  it("permite que admin atualize visita de qualquer gestor", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 99 });
    visitaService.atualizar.mockResolvedValue({ id: 10, denunciado: "Admin Editou" });

    const resposta = await requisitar("PUT", "/10", "admin", 1, {
      denunciado: "Admin Editou",
    });

    expect(resposta.status).toBe(200);
    expect(visitaService.atualizar).toHaveBeenCalledWith(
      "10",
      { denunciado: "Admin Editou" },
      undefined
    );
  });

  it("responde 403 quando outro gestor tenta atualizar visita que não é dele", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 99 });

    const resposta = await requisitar("PUT", "/10", "gestor", 1, {
      denunciado: "Invasão",
    });

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({ mensagem: "Você não tem permissão para alterar uma visita de outro gestor." });
    expect(visitaService.atualizar).not.toHaveBeenCalled();
  });

  it("responde 403 para fiscalizador sem chamar o service", async () => {
    const resposta = await requisitar("PUT", "/10", "fiscalizador", 5, {
      denunciado: "Teste",
    });

    expect(resposta.status).toBe(403);
    expect(visitaService.buscarPorId).not.toHaveBeenCalled();
  });

  it("responde 400 quando o documento já foi gerado", async () => {
    const erro = new Error(
      "O documento da visita já foi gerado; a visita não pode mais ser editada"
    );
    erro.name = "ValidacaoError";
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 1 });
    visitaService.atualizar.mockRejectedValue(erro);

    const resposta = await requisitar("PUT", "/10", "gestor", 1, {
      denunciado: "Novo",
    });

    expect(resposta.status).toBe(400);
  });

  it("responde 400 para id inválido", async () => {
    const resposta = await requisitar("PUT", "/abc", "admin", 1, {
      denunciado: "Novo",
    });

    expect(resposta.status).toBe(400);
    expect(visitaService.buscarPorId).not.toHaveBeenCalled();
  });

  it("responde 400 quando o corpo é vazio ou data_agendada é inválida", async () => {
    const vazio = await requisitar("PUT", "/10", "admin", 1, {});
    expect(vazio.status).toBe(400);

    const dataInvalida = await requisitar("PUT", "/10", "admin", 1, {
      data_agendada: "amanha",
    });
    expect(dataInvalida.status).toBe(400);
    expect(visitaService.buscarPorId).not.toHaveBeenCalled();
  });
});

describe("DELETE /visitas/:id", () => {
  it("remove a visita para o gestor dono e retorna 204", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 1 });
    visitaService.remover.mockResolvedValue({ id: 10 });

    const resposta = await requisitar("DELETE", "/10", "gestor", 1);

    expect(resposta.status).toBe(204);
    expect(visitaService.remover).toHaveBeenCalledWith("10");
  });

  it("permite que admin remova visita de qualquer gestor", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 99 });
    visitaService.remover.mockResolvedValue({ id: 10 });

    const resposta = await requisitar("DELETE", "/10", "admin", 1);

    expect(resposta.status).toBe(204);
  });

  it("responde 403 quando outro gestor tenta remover visita que não é dele", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 99 });

    const resposta = await requisitar("DELETE", "/10", "gestor", 1);

    expect(resposta.status).toBe(403);
    expect(visitaService.remover).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita não existe", async () => {
    visitaService.buscarPorId.mockResolvedValue(null);

    const resposta = await requisitar("DELETE", "/99", "admin", 1);

    expect(resposta.status).toBe(404);
  });

  it("responde 403 para fiscalizador sem chamar o service", async () => {
    const resposta = await requisitar("DELETE", "/10", "fiscalizador", 5);

    expect(resposta.status).toBe(403);
    expect(visitaService.buscarPorId).not.toHaveBeenCalled();
  });

  it("responde 400 quando o documento já foi gerado", async () => {
    const erro = new Error(
      "O documento da visita já foi gerado; a visita não pode mais ser apagada"
    );
    erro.name = "ValidacaoError";
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 1 });
    visitaService.remover.mockRejectedValue(erro);

    const resposta = await requisitar("DELETE", "/10", "gestor", 1);

    expect(resposta.status).toBe(400);
  });
});

describe("rotas compostas /visitas/:id/fiscalizadores (DT-06)", () => {
  it("GET /visitas/:id/fiscalizadores permite fiscalizador associado e bloqueia não associado (403)", async () => {
    visitaService.buscarPorId.mockResolvedValue(visitaDoFiscalizador5);
    visitaService.listarFiscalizadores.mockResolvedValue([{ id: 5, nome: "Ana" }]);

    const ok = await requisitar("GET", "/10/fiscalizadores", "fiscalizador", 5);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([{ id: 5, nome: "Ana" }]);

    const outro = await requisitar("GET", "/10/fiscalizadores", "fiscalizador", 6);
    expect(outro.status).toBe(403);
  });

  it("POST /visitas/:id/fiscalizadores vincula fiscalizador para gestor dono (201) e bloqueia outro gestor (403)", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 1 });
    visitaService.adicionarFiscalizador.mockResolvedValue([{ id: 5, nome: "Ana" }]);

    const ok = await requisitar("POST", "/10/fiscalizadores", "gestor", 1, {
      fiscalizadorId: 5,
    });
    expect(ok.status).toBe(201);
    expect(visitaService.adicionarFiscalizador).toHaveBeenCalledWith("10", 5);

    const outroGestor = await requisitar("POST", "/10/fiscalizadores", "gestor", 2, {
      fiscalizadorId: 5,
    });
    expect(outroGestor.status).toBe(403);
  });

  it("PUT /visitas/:id/fiscalizadores substitui fiscalizadores para admin (200)", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 99 });
    visitaService.substituirFiscalizadores.mockResolvedValue([{ id: 7, nome: "Bruno" }]);

    const resposta = await requisitar("PUT", "/10/fiscalizadores", "admin", 1, {
      fiscalizadoresIds: [7],
    });

    expect(resposta.status).toBe(200);
    expect(visitaService.substituirFiscalizadores).toHaveBeenCalledWith("10", [7]);
  });

  it("DELETE /visitas/:id/fiscalizadores/:fiscalizadorId remove (204), retorna 404 se não vinculado e 400 para id inválido", async () => {
    visitaService.buscarPorId.mockResolvedValue({ id: 10, gestor_id: 1 });
    visitaService.removerFiscalizador.mockResolvedValueOnce({ removido: true });

    const ok = await requisitar("DELETE", "/10/fiscalizadores/5", "gestor", 1);
    expect(ok.status).toBe(204);

    visitaService.removerFiscalizador.mockResolvedValueOnce({ naoVinculado: true });
    const naoVinculado = await requisitar("DELETE", "/10/fiscalizadores/99", "gestor", 1);
    expect(naoVinculado.status).toBe(404);

    const invalido = await requisitar("DELETE", "/10/fiscalizadores/abc", "gestor", 1);
    expect(invalido.status).toBe(400);
  });

  it("POST/PUT/DELETE /visitas/:id/fiscalizadores respondem 403 para fiscalizador", async () => {
    expect((await requisitar("POST", "/10/fiscalizadores", "fiscalizador", 5, { fiscalizadorId: 5 })).status).toBe(403);
    expect((await requisitar("PUT", "/10/fiscalizadores", "fiscalizador", 5, { fiscalizadoresIds: [5] })).status).toBe(403);
    expect((await requisitar("DELETE", "/10/fiscalizadores/5", "fiscalizador", 5)).status).toBe(403);
  });
});
