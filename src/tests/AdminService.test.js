import { beforeEach, describe, expect, it, vi } from "vitest";
import { Op } from "sequelize";

const { Usuario, Visita, VisitaFiscalizador, Documento, Assinatura } =
  vi.hoisted(() => ({
    Usuario: { findAll: vi.fn() },
    Visita: { findAll: vi.fn(), findAndCountAll: vi.fn() },
    VisitaFiscalizador: { findAll: vi.fn() },
    Documento: { count: vi.fn() },
    Assinatura: { count: vi.fn() },
  }));

vi.mock("../models/index.js", () => ({
  default: { Usuario, Visita, VisitaFiscalizador, Documento, Assinatura },
}));

import adminService from "../services/adminService.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adminService.obterDadosGerais", () => {
  it("agrega os totais via GROUP BY de visitas por status, usuários por perfil, documentos e assinaturas", async () => {
    Visita.findAll.mockResolvedValue([
      { status: "agendada", total: "5" },
      { status: "em_andamento", total: "2" },
      { status: "concluida", total: "7" },
      { status: "cancelada", total: "1" },
    ]);

    Usuario.findAll.mockResolvedValue([
      { role: "admin", total: "1" },
      { role: "gestor", total: "3" },
      { role: "fiscalizador", total: "6" },
    ]);

    Documento.count.mockResolvedValue(7);
    Assinatura.count.mockResolvedValue(14);

    const resultado = await adminService.obterDadosGerais();

    expect(resultado).toEqual({
      visitas: {
        total: 15,
        por_status: {
          agendada: 5,
          em_andamento: 2,
          concluida: 7,
          cancelada: 1,
        },
      },
      usuarios: {
        total: 10,
        por_role: {
          admin: 1,
          gestor: 3,
          fiscalizador: 6,
        },
      },
      documentos: {
        total: 7,
      },
      assinaturas: {
        total: 14,
      },
    });
  });
});

describe("adminService.exportarVisitasCsv", () => {
  it("gera CSV com BOM, cabeçalho, campos escapados, metadados e neutraliza injeção de fórmulas", async () => {
    Visita.findAndCountAll.mockResolvedValue({
      count: 25,
      rows: [
        {
          id: 10,
          denunciado: '=HYPERLINK("http://evil.com","Mercado")',
          status: "concluida",
          gestor: { nome: "Carlos" },
          fiscalizadores: [{ nome: "Ana" }, { nome: "Bruno" }],
          data_agendada: new Date("2026-12-01T10:00:00.000Z"),
          data_realizacao: null,
          latitude: "-23.55052000",
          longitude: "-46.63330800",
          observacoes_livres: "+SUM(A1:A2)\nLinha 2",
        },
      ],
    });

    const resultado = await adminService.exportarVisitasCsv({
      status: "concluida",
      limit: "100",
      offset: "10",
    });

    expect(Visita.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "concluida" },
        distinct: true,
        limit: 100,
        offset: 10,
      })
    );
    expect(resultado).toEqual({
      csv: '\uFEFFid,denunciado,status,gestor,fiscalizadores,data_agendada,data_realizacao,latitude,longitude,observacoes_livres\r\n10,"\'=HYPERLINK(""http://evil.com"",""Mercado"")",concluida,Carlos,Ana; Bruno,2026-12-01T10:00:00.000Z,,-23.55052000,-46.63330800,"\'+SUM(A1:A2)\nLinha 2"',
      total: 25,
      truncado: true,
    });
  });

  it("preserva todos os fiscalizadores da visita ao filtrar por fiscalizador_id", async () => {
    VisitaFiscalizador.findAll.mockResolvedValue([{ visita_id: 10 }]);
    Visita.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [
        {
          id: 10,
          denunciado: "Loja A",
          status: "agendada",
          gestor: { nome: "Carlos" },
          fiscalizadores: [{ nome: "Ana" }, { nome: "Bruno" }],
          data_agendada: new Date("2026-12-01T10:00:00.000Z"),
          data_realizacao: null,
          latitude: null,
          longitude: null,
          observacoes_livres: null,
        },
      ],
    });

    const resultado = await adminService.exportarVisitasCsv({
      fiscalizador_id: "5",
    });

    expect(VisitaFiscalizador.findAll).toHaveBeenCalledWith({
      where: { fiscalizador_id: "5" },
      attributes: ["visita_id"],
      raw: true,
    });
    expect(Visita.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { [Op.in]: [10] } },
      })
    );
    expect(resultado.csv).toContain("Ana; Bruno");
    expect(resultado.total).toBe(1);
    expect(resultado.truncado).toBe(false);
  });

  it("gera apenas o cabeçalho quando o fiscalizador não possui visitas", async () => {
    VisitaFiscalizador.findAll.mockResolvedValue([]);

    const resultado = await adminService.exportarVisitasCsv({
      fiscalizador_id: "99",
    });

    expect(Visita.findAndCountAll).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      csv: "\uFEFFid,denunciado,status,gestor,fiscalizadores,data_agendada,data_realizacao,latitude,longitude,observacoes_livres",
      total: 0,
      truncado: false,
    });
  });
});
