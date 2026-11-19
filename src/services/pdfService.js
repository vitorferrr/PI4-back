import PDFDocument from "pdfkit";

const gerarPdf = (desenhar, opcoes = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, ...opcoes });
    const partes = [];

    doc.on("data", (parte) => partes.push(parte));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    try {
      desenhar(doc);
      doc.end();
    } catch (erro) {
      reject(erro);
    }
  });

export default {
  gerarPdf,
};