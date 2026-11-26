import { z } from "zod";
import { validarListaRespostas } from "../utils/validarRespostas.js";

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

// Um erro só para a lista inteira (e não um por item), como antes.
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
    senha: senhaSchema(),
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

/**
 * Schema das observações livres da visita (PATCH /visitas/:id/observacoes).
 * Aceita texto (até 5000 caracteres, sem contar os espaços das pontas) ou null.
 */
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
