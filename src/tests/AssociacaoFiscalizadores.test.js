import { describe, expect, it } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import getUsuarioModel from "../models/usuario.js";
import getVisitaModel from "../models/visita.js";
import getVisitaFiscalizadorModel from "../models/visitaFiscalizador.js";

const sequelize = new Sequelize("postgres://teste:teste@localhost:5432/teste", {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
});
const Usuario = getUsuarioModel(sequelize, Sequelize);
const Visita = getVisitaModel(sequelize, Sequelize);
const VisitaFiscalizador = getVisitaFiscalizadorModel(sequelize, Sequelize);
Visita.associate({
  Usuario,
  Visita,
  VisitaFiscalizador,
  RespostaQuestionario: sequelize.define("resposta_questionario", {}),
  Documento: sequelize.define("documento", {}),
});

describe("associação visita ↔ fiscalizadores", () => {
  it.each([
    "getFiscalizadores",
    "setFiscalizadores",
    "addFiscalizador",
    "removeFiscalizador",
  ])("a visita tem o método %s", (metodo) => {
    expect(typeof Visita.build()[metodo]).toBe("function");
  });
});
