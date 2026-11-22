import { randomUUID } from "node:crypto";
import { getStorageContext } from "../config/supabase.js";

const EXTENSOES = new Map([
  ["image/png", "png"],
  ["application/pdf", "pdf"],
]);
const CAMINHO_SEGURO = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const OBJETO_SEGURO = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:png|pdf)$/;
const EXPIRACAO_MAXIMA_SEGUNDOS = 86400;
const consultasPendentes = new WeakMap();

const erroParametro = () => {
  const erro = new Error("Parâmetros de armazenamento inválidos.");
  erro.name = "StorageError";
  erro.codigo = "STORAGE_PARAMETRO_INVALIDO";
  return erro;
};

const erroStorage = (codigo, mensagem) => {
  const erro = new Error(mensagem);
  erro.name = "StorageError";
  erro.codigo = codigo;
  return erro;
};

const contextoDaReferencia = (referencia) => {
  const { bucket, path } = referencia ?? {};
  if (typeof bucket !== "string" || typeof path !== "string" ||
      path.length > 300 || !OBJETO_SEGURO.test(path)) {
    throw erroParametro();
  }
  const contexto = getStorageContext();
  if (bucket !== contexto.bucket) throw erroParametro();
  return { ...contexto, path };
};

const consultarBucketPrivado = async (client, bucket) => {
  let consulta;
  try {
    consulta = await client.storage.getBucket(bucket);
  } catch {
    throw erroStorage("STORAGE_BUCKET_INDISPONIVEL", "Não foi possível verificar o bucket de armazenamento.");
  }
  if (consulta?.error || !consulta?.data || consulta.data.id !== bucket) {
    throw erroStorage("STORAGE_BUCKET_INDISPONIVEL", "Não foi possível verificar o bucket de armazenamento.");
  }
  if (consulta.data.public !== false) {
    throw erroStorage("STORAGE_BUCKET_NAO_PRIVADO", "Operação bloqueada: o bucket deve ser privado.");
  }
};

const verificarBucketPrivado = async (client, bucket) => {
  let pendentes = consultasPendentes.get(client);
  if (!pendentes) {
    pendentes = new Map();
    consultasPendentes.set(client, pendentes);
  }
  if (!pendentes.has(bucket)) {
    const consulta = consultarBucketPrivado(client, bucket).finally(() => pendentes.delete(bucket));
    pendentes.set(bucket, consulta);
  }
  // Compartilha somente a consulta em andamento. Sem cache de sucesso/erro:
  // a próxima operação sequencial sempre consulta a configuração remota.
  await pendentes.get(bucket);
};

// Recebe bytes já validados pelo domínio; não decodifica imagens nem PDFs.
export const uploadArquivo = async (parametros = {}) => {
  const { conteudo, contentType, diretorio } = parametros ?? {};
  if (
    !(Buffer.isBuffer(conteudo) || conteudo instanceof Uint8Array) ||
    conteudo.byteLength === 0 ||
    !EXTENSOES.has(contentType) ||
    typeof diretorio !== "string" || diretorio.length > 200 ||
    !CAMINHO_SEGURO.test(diretorio)
  ) {
    throw erroParametro();
  }

  const { client, bucket } = getStorageContext();
  const path = `${diretorio}/${randomUUID()}.${EXTENSOES.get(contentType)}`;

  await verificarBucketPrivado(client, bucket);

  try {
    const resultado = await client.storage.from(bucket).upload(path, conteudo, {
      contentType,
      upsert: false,
    });
    if (resultado?.error || resultado?.data?.path !== path) throw new Error();
    return { bucket, path };
  } catch {
    throw erroStorage("STORAGE_UPLOAD_FALHOU", "Não foi possível enviar o arquivo ao armazenamento.");
  }
};

export const removerArquivo = async (referencia = {}) => {
  const { client, bucket, path } = contextoDaReferencia(referencia);

  // Uma única chave exata. Não depende da privacidade atual para permitir
  // compensação mesmo se a configuração remota mudar depois do upload.
  try {
    const resultado = await client.storage.from(bucket).remove([path]);
    if (!resultado || resultado.error || !Array.isArray(resultado.data)) throw new Error();
  } catch {
    throw erroStorage("STORAGE_REMOCAO_FALHOU", "Não foi possível remover o arquivo do armazenamento.");
  }
};

export const baixarArquivo = async (referencia) => {
  const { client, bucket, path } = contextoDaReferencia(referencia);
  await verificarBucketPrivado(client, bucket);
  try {
    const resultado = await client.storage.from(bucket).download(path);
    if (resultado?.error || !resultado?.data) throw new Error();
    return Buffer.from(await resultado.data.arrayBuffer());
  } catch {
    throw erroStorage("STORAGE_DOWNLOAD_FALHOU", "Não foi possível baixar o arquivo do armazenamento.");
  }
};

export const gerarUrlAssinada = async (referencia, expiraEmSegundos = 3600) => {
  if (!Number.isInteger(expiraEmSegundos) || expiraEmSegundos < 1 ||
      expiraEmSegundos > EXPIRACAO_MAXIMA_SEGUNDOS) throw erroParametro();
  const { client, bucket, path } = contextoDaReferencia(referencia);
  await verificarBucketPrivado(client, bucket);
  try {
    const resultado = await client.storage.from(bucket).createSignedUrl(path, expiraEmSegundos);
    if (resultado?.error || typeof resultado?.data?.signedUrl !== "string" ||
        !resultado.data.signedUrl.trim()) throw new Error();
    return resultado.data.signedUrl;
  } catch {
    throw erroStorage("STORAGE_URL_ASSINADA_FALHOU", "Não foi possível gerar acesso temporário ao arquivo.");
  }
};

export default { uploadArquivo, removerArquivo, baixarArquivo, gerarUrlAssinada };
