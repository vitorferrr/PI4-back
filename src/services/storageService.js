import { randomUUID } from "node:crypto";
import { getStorageContext } from "../config/supabase.js";

const EXTENSOES = new Map([
  ["image/png", "png"],
  ["application/pdf", "pdf"],
]);
// Exige fim absoluto: "$" sozinho também aceita uma quebra de linha final.
const CAMINHO_SEGURO = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?![\s\S])/;
const OBJETO_SEGURO = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:png|pdf)(?![\s\S])/;

const erroParametro = () => {
  const erro = new Error("Parâmetros de armazenamento inválidos.");
  erro.name = "ValidacaoError";
  erro.codigo = "STORAGE_PARAMETRO_INVALIDO";
  return erro;
};

const erroStorage = (codigo, mensagem) => {
  const erro = new Error(mensagem);
  erro.name = "StorageError";
  erro.codigo = codigo;
  return erro;
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
    throw erroStorage("STORAGE_BUCKET_NAO_PRIVADO", "Upload bloqueado: o bucket deve ser privado.");
  }

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
  const { bucket, path } = referencia ?? {};
  if (
    typeof bucket !== "string" ||
    typeof path !== "string" || path.length > 300 ||
    !OBJETO_SEGURO.test(path)
  ) {
    throw erroParametro();
  }
  const { client, bucket: bucketConfigurado } = getStorageContext();
  if (bucket !== bucketConfigurado) throw erroParametro();

  // Uma única chave exata. Não depende da privacidade atual para permitir
  // compensação mesmo se a configuração remota mudar depois do upload.
  try {
    const resultado = await client.storage.from(bucket).remove([path]);
    if (!resultado || resultado.error || !Array.isArray(resultado.data)) throw new Error();
  } catch {
    throw erroStorage("STORAGE_REMOCAO_FALHOU", "Não foi possível remover o arquivo do armazenamento.");
  }
};

export default { uploadArquivo, removerArquivo };
