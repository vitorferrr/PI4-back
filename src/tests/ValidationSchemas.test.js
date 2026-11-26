import { describe, expect, it } from "vitest";
import {
  adicionarFiscalizadorSchema,
  atualizarPerguntaSchema,
  criarPerguntaSchema,
  iniciarVisitaSchema,
  loginSchema,
  observacoesVisitaSchema,
  registrarAssinaturaSchema,
  signupSchema,
  substituirFiscalizadoresSchema,
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

describe("observacoesVisitaSchema", () => {
  it("aceita texto ou null e recusa texto longo demais", () => {
    expect(validar(observacoesVisitaSchema, { body: { observacoes_livres: null } }).ok).toBe(true);
    expect(
      validar(observacoesVisitaSchema, { body: { observacoes_livres: "a".repeat(5001) } }).mensagens
    ).toEqual(["observacoes_livres deve ter no máximo 5000 caracteres"]);
  });
});

describe("loginSchema e signupSchema", () => {
  it("login exige email e senha preenchidos", () => {
    expect(validar(loginSchema, { body: { email: "a@b.com", senha: "x" } }).ok).toBe(true);
    expect(validar(loginSchema, { body: { email: "a@b.com" } }).mensagens).toEqual([
      "Email e senha são obrigatórios",
    ]);
  });

  it("signup avisa primeiro o campo faltando e só depois o tamanho da senha", () => {
    expect(validar(signupSchema, { body: { nome: "", email: "a@b.com", senha: "1" } }).mensagens).toEqual([
      "Nome, email e senha são obrigatórios",
    ]);
    expect(validar(signupSchema, { body: { nome: "Ana", email: "a@b.com", senha: "1234567" } }).mensagens).toEqual([
      "A senha deve ter entre 8 e 72 caracteres",
    ]);
  });

  it("signup aceita matrícula em texto ou nula e recusa número", () => {
    const corpo = { nome: "Ana", email: "a@b.com", senha: "senha-forte" };
    expect(validar(signupSchema, { body: { ...corpo, matricula: null } }).ok).toBe(true);
    expect(validar(signupSchema, { body: { ...corpo, matricula: 1 } }).mensagens).toEqual([
      "A matrícula deve ser um texto",
    ]);
  });
});

describe("schemas de pergunta", () => {
  it("criação exige texto, tipo_resposta conhecido e ordem positiva", () => {
    expect(
      validar(criarPerguntaSchema, { body: { texto: "Tem alvará?", tipo_resposta: "sim_nao", ordem: 1 } }).ok
    ).toBe(true);
    expect(validar(criarPerguntaSchema, { body: { texto: "", tipo_resposta: "x", ordem: 0 } }).mensagens).toEqual([
      "O texto da pergunta é obrigatório",
      "tipo_resposta deve ser um dos valores: sim_nao, numero, data, texto",
      "ordem deve ser um número inteiro positivo",
    ]);
  });

  it("atualização exige ao menos um dos campos da pergunta", () => {
    expect(validar(atualizarPerguntaSchema, { body: { ordem: 2 } }).ok).toBe(true);
    expect(validar(atualizarPerguntaSchema, { body: { outro: 1 } }).mensagens).toEqual([
      "Informe ao menos um campo para atualizar",
    ]);
  });
});

describe("schemas de fiscalizadores da visita", () => {
  it("POST aceita fiscalizadorId ou fiscalizador_id", () => {
    expect(validar(adicionarFiscalizadorSchema, { body: { fiscalizadorId: 3 } }).ok).toBe(true);
    expect(validar(adicionarFiscalizadorSchema, { body: { fiscalizador_id: 3 } }).ok).toBe(true);
    expect(validar(adicionarFiscalizadorSchema, { body: {} }).mensagens).toEqual([
      "fiscalizadorId deve ser um número inteiro positivo",
    ]);
  });

  it("PUT exige exatamente um fiscal válido", () => {
    expect(validar(substituirFiscalizadoresSchema, { body: { fiscalizadores_ids: [3] } }).ok).toBe(true);
    expect(validar(substituirFiscalizadoresSchema, { body: { fiscalizadoresIds: [3, 4] } }).mensagens).toEqual([
      "A visita deve ter exatamente um agente fiscalizador",
    ]);
    expect(validar(substituirFiscalizadoresSchema, { body: { fiscalizadoresIds: ["a"] } }).mensagens).toEqual([
      "fiscalizadores_ids deve ser uma lista de IDs inteiros positivos",
    ]);
  });
});

describe("iniciarVisitaSchema e registrarAssinaturaSchema", () => {
  it("iniciar exige latitude e longitude válidas", () => {
    expect(validar(iniciarVisitaSchema, { body: { latitude: -8.1, longitude: -35 } }).ok).toBe(true);
    expect(validar(iniciarVisitaSchema, { body: { latitude: 91, longitude: -35 } }).mensagens).toEqual([
      "A latitude deve ser um número entre -90 e 90",
    ]);
  });

  it("assinatura confere o tipo de assinante e o recusou", () => {
    expect(validar(registrarAssinaturaSchema, { body: { assinante_tipo: "denunciado", recusou: true } }).ok).toBe(true);
    expect(
      validar(registrarAssinaturaSchema, { body: { assinante_tipo: "x", recusou: "sim" } }).mensagens
    ).toEqual([
      "O tipo de assinante deve ser fiscalizador ou denunciado",
      "O campo recusou deve ser verdadeiro ou falso",
    ]);
  });
});
