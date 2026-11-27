import { z } from "zod";
import { validarListaRespostas } from "../utils/index.js";

const ROLES_VALIDAS = ["admin", "gestor", "fiscalizador"];
const STATUS_VISITA_VALIDOS = ["agendada", "em_andamento", "concluida", "cancelada"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const ID_MAXIMO = 2147483647;
const TAMANHO_MAXIMO_OBSERVACOES = 5000;

const MENSAGEM_CORPO_OBJETO = "O corpo da requisição deve ser um objeto JSON";
const MENSAGEM_CORPO_VAZIO = "Informe ao menos um campo para atualizar";
const MENSAGEM_EMAIL = "Informe um email válido";
const MENSAGEM_SENHA = "A senha deve ter ao menos 6 caracteres";
const MENSAGEM_ROLE = "Perfil (role) inválido";
const MENSAGEM_DATA = "Informe uma data_agendada válida no formato ISO 8601";
const MENSAGEM_GESTOR = "gestor_id deve ser um número inteiro positivo";
const MENSAGEM_FISCALIZADORES =
  "fiscalizadores_ids deve ser uma lista de IDs inteiros positivos";

const dataValida = (valor) => {
  if (valor instanceof Date) {
    return !Number.isNaN(valor.getTime());
  }
  if (typeof valor !== "string") {
    return false;
  }

  const partes = ISO_DATE_REGEX.exec(valor);
  if (!partes) {
    return false;
  }

  const [, anoStr, mesStr, diaStr] = partes;
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);

  const dataUtc = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    dataUtc.getUTCFullYear() !== ano ||
    dataUtc.getUTCMonth() !== mes - 1 ||
    dataUtc.getUTCDate() !== dia
  ) {
    return false;
  }

  return !Number.isNaN(new Date(valor).getTime());
};


const textoPreenchidoSchema = (mensagem) =>
  z
    .string({ error: mensagem })
    .refine((valor) => valor.trim().length > 0, { error: mensagem });

const emailSchema = () =>
  z
    .string({ error: MENSAGEM_EMAIL })
    .refine((valor) => EMAIL_REGEX.test(valor.trim()), { error: MENSAGEM_EMAIL });

const senhaSchema = () =>
  z
    .string({ error: MENSAGEM_SENHA })
    .refine((valor) => valor.trim().length >= 6, { error: MENSAGEM_SENHA });

const roleSchema = () => z.enum(ROLES_VALIDAS, { error: MENSAGEM_ROLE });

const idSchema = (mensagem) =>
  z
    .number({ error: mensagem })
    .int({ error: mensagem })
    .min(1, { error: mensagem })
    .max(ID_MAXIMO, { error: mensagem });

const listaIdsSchema = () =>
  z
    .array(z.unknown(), { error: MENSAGEM_FISCALIZADORES })
    .refine((lista) => lista.every((id) => idSchema("").safeParse(id).success), {
      error: MENSAGEM_FISCALIZADORES,
    });

const coordenadaSchema = (limite, mensagem) =>
  z
    .number({ error: mensagem })
    .refine((valor) => Number.isFinite(valor) && Math.abs(valor) <= limite, {
      error: mensagem,
    });

const dataSchema = () =>
  z.unknown().refine(dataValida, { error: MENSAGEM_DATA });

const idQuerySchema = (mensagem, { aceitaZero = false } = {}) =>
  z
    .string({ error: mensagem })
    .refine(
      (valor) =>
        (aceitaZero ? /^\d+$/ : /^[1-9]\d*$/).test(valor) && Number(valor) <= ID_MAXIMO,
      { error: mensagem }
    );

const corpoSchema = (campos, mensagem = MENSAGEM_CORPO_OBJETO) =>
  z.looseObject(campos, { error: mensagem });

const corpoAtualizacaoSchema = (campos) =>
  corpoSchema(campos, MENSAGEM_CORPO_VAZIO).refine(
    (corpo) => Object.keys(corpo).length > 0,
    { error: MENSAGEM_CORPO_VAZIO }
  );

export const listarUsuariosSchema = z.object({
  query: z.looseObject({
    aprovado: z
      .enum(["true", "false"], { error: "aprovado deve ser true ou false" })
      .optional(),
  }),
});


export const criarUsuarioSchema = z.object({
  body: corpoSchema({
    nome: textoPreenchidoSchema("O campo nome é obrigatório"),
    email: emailSchema(),
    role: roleSchema(),
  }),
});


export const atualizarUsuarioSchema = z.object({
  body: corpoAtualizacaoSchema({
    nome: textoPreenchidoSchema("O campo nome não pode ser vazio").optional(),
    email: emailSchema().optional(),
    senha: senhaSchema().optional(),
    role: roleSchema().optional(),
  }),
});


export const criarVisitaSchema = z.object({
  body: corpoSchema({
    denunciado: textoPreenchidoSchema("O campo denunciado é obrigatório"),
    data_agendada: dataSchema(),
    gestor_id: idSchema(MENSAGEM_GESTOR).optional(),
    fiscalizadores_ids: listaIdsSchema().optional(),
    fiscalizadores: listaIdsSchema().optional(),
    latitude: coordenadaSchema(90, "A latitude deve ser um número entre -90 e 90").optional(),
    longitude: coordenadaSchema(180, "A longitude deve ser um número entre -180 e 180").optional(),
  }),
});


export const atualizarVisitaSchema = z.object({
  body: corpoAtualizacaoSchema({
    denunciado: textoPreenchidoSchema("O campo denunciado não pode ser vazio").optional(),
    data_agendada: dataSchema().optional(),
    gestor_id: idSchema(MENSAGEM_GESTOR).optional(),
    fiscalizadores_ids: listaIdsSchema().optional(),
    fiscalizadores: listaIdsSchema().optional(),
    status: z
      .literal("cancelada", {
        error: "Na edição da visita, o único status permitido é 'cancelada'",
      })
      .optional(),
  }),
});


export const listarVisitasSchema = z.object({
  query: z.looseObject({
    status: z.enum(STATUS_VISITA_VALIDOS, { error: "Status de filtro inválido" }).optional(),
    gestor_id: idQuerySchema(MENSAGEM_GESTOR).optional(),
    fiscalizador_id: idQuerySchema("fiscalizador_id deve ser um número inteiro positivo").optional(),
    limit: idQuerySchema("limit deve ser um número inteiro positivo").optional(),
    offset: idQuerySchema("offset deve ser um número inteiro não negativo", {
      aceitaZero: true,
    }).optional(),
  }),
});


export const atualizarRespostaSchema = z.object({
  body: corpoSchema({
    resposta: textoPreenchidoSchema("A resposta deve ser um texto preenchido"),
  }),
});


export const salvarRespostasSchema = z.object({
  body: corpoSchema({
    respostas: z.unknown().superRefine((respostas, ctx) => {
      validarListaRespostas(respostas).forEach((mensagem) =>
        ctx.addIssue({ code: "custom", message: mensagem })
      );
    }),
  }),
});


export const observacoesVisitaSchema = z.object({
  body: corpoSchema({
    observacoes_livres: z
      .string({ error: "observacoes_livres deve ser um texto ou null" })
      .refine((valor) => valor.trim().length <= TAMANHO_MAXIMO_OBSERVACOES, {
        error: `observacoes_livres deve ter no máximo ${TAMANHO_MAXIMO_OBSERVACOES} caracteres`,
      })
      .nullable(),
  }),
});

const MENSAGEM_LOGIN = "Email e senha são obrigatórios";
const MENSAGEM_SIGNUP = "Nome, email e senha são obrigatórios";
const MENSAGEM_UM_FISCAL = "A visita deve ter exatamente um agente fiscalizador";
const TIPOS_RESPOSTA = ["sim_nao", "numero", "data", "texto"];
const SENHA_SIGNUP_MINIMA = 8;
const SENHA_SIGNUP_MAXIMA = 72;

const obrigatorioSchema = (mensagem) =>
  z.string({ error: mensagem }).min(1, { error: mensagem });


export const loginSchema = z.object({
  body: corpoSchema(
    {
      email: obrigatorioSchema(MENSAGEM_LOGIN),
      senha: obrigatorioSchema(MENSAGEM_LOGIN),
    },
    MENSAGEM_LOGIN
  ),
});


export const signupSchema = z.object({
  body: corpoSchema(
    {
      nome: textoPreenchidoSchema(MENSAGEM_SIGNUP),
      email: textoPreenchidoSchema(MENSAGEM_SIGNUP),
      senha: textoPreenchidoSchema(MENSAGEM_SIGNUP),
      matricula: z.string({ error: "A matrícula deve ser um texto" }).nullish(),
    },
    MENSAGEM_SIGNUP
  ).refine(
    ({ senha }) =>
      senha.length >= SENHA_SIGNUP_MINIMA && Buffer.byteLength(senha) <= SENHA_SIGNUP_MAXIMA,
    {
      path: ["senha"],
      error: `A senha deve ter entre ${SENHA_SIGNUP_MINIMA} e ${SENHA_SIGNUP_MAXIMA} caracteres`,
      when: (payload) => payload.issues.length === 0,
    }
  ),
});

const perguntaCampos = {
  texto: textoPreenchidoSchema("O texto da pergunta é obrigatório"),
  tipo_resposta: z.enum(TIPOS_RESPOSTA, {
    error: `tipo_resposta deve ser um dos valores: ${TIPOS_RESPOSTA.join(", ")}`,
  }),
  ordem: z
    .number({ error: "ordem deve ser um número inteiro positivo" })
    .int({ error: "ordem deve ser um número inteiro positivo" })
    .min(1, { error: "ordem deve ser um número inteiro positivo" }),
};


export const criarPerguntaSchema = z.object({
  body: corpoSchema(perguntaCampos, "Dados da pergunta inválidos"),
});

export const atualizarPerguntaSchema = z.object({
  body: corpoSchema(
    {
      texto: perguntaCampos.texto.optional(),
      tipo_resposta: perguntaCampos.tipo_resposta.optional(),
      ordem: perguntaCampos.ordem.optional(),
    },
    "Dados da pergunta inválidos"
  ).refine(
    (corpo) => ["texto", "tipo_resposta", "ordem"].some((campo) => corpo[campo] !== undefined),
    { error: MENSAGEM_CORPO_VAZIO }
  ),
});


export const adicionarFiscalizadorSchema = z.object({
  body: corpoSchema({}).superRefine((corpo, ctx) => {
    const id = corpo.fiscalizadorId ?? corpo.fiscalizador_id;

    if (!idSchema("").safeParse(id).success) {
      ctx.addIssue({
        code: "custom",
        path: ["fiscalizadorId"],
        message: "fiscalizadorId deve ser um número inteiro positivo",
      });
    }
  }),
});


export const substituirFiscalizadoresSchema = z.object({
  body: corpoSchema({}).superRefine((corpo, ctx) => {
    const lista = corpo.fiscalizadoresIds ?? corpo.fiscalizadores_ids;
    const caminho = ["fiscalizadoresIds"];

    if (!Array.isArray(lista) || new Set(lista).size !== 1) {
      ctx.addIssue({ code: "custom", path: caminho, message: MENSAGEM_UM_FISCAL });
      return;
    }

    if (!lista.every((id) => idSchema("").safeParse(id).success)) {
      ctx.addIssue({ code: "custom", path: caminho, message: MENSAGEM_FISCALIZADORES });
    }
  }),
});

export const iniciarVisitaSchema = z.object({
  body: corpoSchema({
    latitude: coordenadaSchema(90, "A latitude deve ser um número entre -90 e 90"),
    longitude: coordenadaSchema(180, "A longitude deve ser um número entre -180 e 180"),
  }),
});

export const registrarAssinaturaSchema = z.object({
  body: corpoSchema({
    assinante_tipo: z.enum(["fiscalizador", "denunciado"], {
      error: "O tipo de assinante deve ser fiscalizador ou denunciado",
    }),
    recusou: z.boolean({ error: "O campo recusou deve ser verdadeiro ou falso" }).nullish(),
  }),
});
