import { describe, expect, it } from "vitest";
import {
  atualizarRespostaSchema,
  atualizarUsuarioSchema,
  atualizarVisitaSchema,
  criarUsuarioSchema,
  criarVisitaSchema,
  listarUsuariosSchema,
  listarVisitasSchema,
  salvarRespostasSchema,
} from "../middlewares/validationSchemas.js";

const validar = (schema, { body, query = {}, params = {} } = {}) => {
  const resultado = schema.safeParse({ body, query, params });
  return resultado.success
    ? { ok: true, dados: resultado.data }
    : { ok: false, mensagens: [...new Set(resultado.error.issues.map((i) => i.message))] };
};

describe("criarUsuarioSchema", () => {
  const valido = { nome: "Bia", email: "bia@exemplo.com", senha: "123456", role: "gestor" };

  it("aceita um usuário válido sem mudar os valores", () => {
    const corpo = { ...valido, email: " bia@exemplo.com " };
    expect(validar(criarUsuarioSchema, { body: corpo }).dados.body).toEqual(corpo);
  });

  it("recusa cada campo inválido com a mensagem de sempre", () => {
    expect(
      validar(criarUsuarioSchema, {
        body: { nome: "  ", email: "bia.com", senha: "12345", role: "chefe" },
      }).mensagens
    ).toEqual([
      "O campo nome é obrigatório",
      "Informe um email válido",
      "A senha deve ter ao menos 6 caracteres",
      "Perfil (role) inválido",
    ]);
  });

  it.each([undefined, [], "texto"])("recusa corpo que não é objeto (%o)", (body) => {
    expect(validar(criarUsuarioSchema, { body }).mensagens).toEqual([
      "O corpo da requisição deve ser um objeto JSON",
    ]);
  });
});

describe("atualizarUsuarioSchema", () => {
  it.each([{}, undefined])("exige ao menos um campo (%o)", (body) => {
    expect(validar(atualizarUsuarioSchema, { body }).mensagens).toEqual([
      "Informe ao menos um campo para atualizar",
    ]);
  });

  it("aceita atualização parcial e recusa campo enviado vazio", () => {
    expect(validar(atualizarUsuarioSchema, { body: { nome: "Ana" } }).ok).toBe(true);
    expect(validar(atualizarUsuarioSchema, { body: { nome: "" } }).mensagens).toEqual([
      "O campo nome não pode ser vazio",
    ]);
  });
});

describe("criarVisitaSchema", () => {
  const valida = { denunciado: "Loja X", data_agendada: "2026-12-01" };

  it("mantém campos que o schema não lista (ex.: endereço)", () => {
    const body = { ...valida, endereco: "Rua A", fiscalizadores_ids: [2] };
    expect(validar(criarVisitaSchema, { body }).dados.body).toEqual(body);
  });

  it("recusa data que não existe no calendário", () => {
    expect(
      validar(criarVisitaSchema, { body: { ...valida, data_agendada: "2026-02-30" } }).mensagens
    ).toEqual(["Informe uma data_agendada válida no formato ISO 8601"]);
  });

  it("recusa ids, fiscalizadores e coordenadas fora do formato", () => {
    expect(
      validar(criarVisitaSchema, {
        body: { ...valida, gestor_id: "1", fiscalizadores_ids: [0], latitude: 91, longitude: 181 },
      }).mensagens
    ).toEqual([
      "gestor_id deve ser um número inteiro positivo",
      "fiscalizadores_ids deve ser uma lista de IDs inteiros positivos",
      "A latitude deve ser um número entre -90 e 90",
      "A longitude deve ser um número entre -180 e 180",
    ]);
  });
});

describe("atualizarVisitaSchema", () => {
  it("só aceita o status 'cancelada'", () => {
    expect(validar(atualizarVisitaSchema, { body: { status: "cancelada" } }).ok).toBe(true);
    expect(validar(atualizarVisitaSchema, { body: { status: "concluida" } }).mensagens).toEqual([
      "Na edição da visita, o único status permitido é 'cancelada'",
    ]);
  });

  it("exige ao menos um campo", () => {
    expect(validar(atualizarVisitaSchema, { body: {} }).mensagens).toEqual([
      "Informe ao menos um campo para atualizar",
    ]);
  });
});

describe("schemas de query", () => {
  it("valida o filtro aprovado da listagem de usuários", () => {
    expect(validar(listarUsuariosSchema, { query: { aprovado: "false" } }).ok).toBe(true);
    expect(validar(listarUsuariosSchema, { query: { aprovado: "FALSE" } }).mensagens).toEqual([
      "aprovado deve ser true ou false",
    ]);
  });

  it("valida status, ids e paginação da listagem de visitas", () => {
    expect(
      validar(listarVisitasSchema, { query: { status: "agendada", limit: "10", offset: "0" } }).ok
    ).toBe(true);
    expect(
      validar(listarVisitasSchema, {
        query: { status: "x", gestor_id: "0", limit: "0", offset: "-1" },
      }).mensagens
    ).toEqual([
      "Status de filtro inválido",
      "gestor_id deve ser um número inteiro positivo",
      "limit deve ser um número inteiro positivo",
      "offset deve ser um número inteiro não negativo",
    ]);
  });
});

describe("schemas de respostas", () => {
  it("exige texto preenchido ao editar uma resposta", () => {
    expect(validar(atualizarRespostaSchema, { body: { resposta: "Sim" } }).ok).toBe(true);
    expect(validar(atualizarRespostaSchema, { body: { resposta: "" } }).mensagens).toEqual([
      "A resposta deve ser um texto preenchido",
    ]);
  });

  it("reaproveita validarListaRespostas para a lista enviada", () => {
    expect(
      validar(salvarRespostasSchema, { body: { respostas: [{ pergunta_id: 1, resposta: "Sim" }] } }).ok
    ).toBe(true);
    expect(validar(salvarRespostasSchema, { body: { respostas: [] } }).mensagens).toEqual([
      "Envie ao menos uma resposta em 'respostas'",
    ]);
  });
});
