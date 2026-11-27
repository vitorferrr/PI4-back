import { campoTextoOpcional } from "../utils/index.js";

const getVisitaModel = (sequelize, { DataTypes }) => {
  const Visita = sequelize.define(
    "visita",
    {
      denunciado: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      gestor_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "usuarios",
          key: "id",
        },
      },
      status: {
        type: DataTypes.ENUM("agendada", "em_andamento", "concluida", "cancelada"),
        allowNull: false,
        defaultValue: "agendada",
        validate: {
          isIn: {
            args: [["agendada", "em_andamento", "concluida", "cancelada"]],
            msg: "Status deve ser agendada, em_andamento, concluida ou cancelada",
          },
        },
      },
      latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
        validate: {
          min: -90,
          max: 90,
        },
      },
      longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
        validate: {
          min: -180,
          max: 180,
        },
      },
      data_agendada: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      data_realizacao: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      observacoes_livres: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      ...campoTextoOpcional(DataTypes, "razao_social", "Razão social"),
      ...campoTextoOpcional(DataTypes, "nome_fantasia", "Nome fantasia"),
      ...campoTextoOpcional(DataTypes, "endereco", "Endereço"),
      ...campoTextoOpcional(DataTypes, "bairro", "Bairro"),
      ...campoTextoOpcional(DataTypes, "cep", "CEP"),
      ...campoTextoOpcional(DataTypes, "telefone", "Telefone"),
      ...campoTextoOpcional(DataTypes, "cnpj_cpf", "CNPJ/CPF"),
      ...campoTextoOpcional(DataTypes, "atividade", "Atividade"),
    },
    {
      tableName: "visitas",
      underscored: true,
    }
  );

  Visita.associate = (models) => {
    Visita.belongsTo(models.Usuario, {
      foreignKey: "gestor_id",
      as: "gestor",
      onDelete: "RESTRICT",
    });

    Visita.belongsToMany(models.Usuario, {
      through: models.VisitaFiscalizador,
      foreignKey: "visita_id",
      otherKey: "fiscalizador_id",
      as: "fiscalizadores",
    });

    Visita.hasMany(models.RespostaQuestionario, {
      foreignKey: "visita_id",
      as: "respostas",
      onDelete: "CASCADE",
    });

    Visita.hasMany(models.Documento, {
      foreignKey: "visita_id",
      as: "documentos",
      onDelete: "CASCADE",
    });
  };

  return Visita;
};

export default getVisitaModel;
