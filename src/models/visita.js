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
      razao_social: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "Razão social deve ter no máximo 255 caracteres",
          },
        },
      },
      nome_fantasia: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "Nome fantasia deve ter no máximo 255 caracteres",
          },
        },
      },
      endereco: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "Endereço deve ter no máximo 255 caracteres",
          },
        },
      },
      bairro: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "Bairro deve ter no máximo 255 caracteres",
          },
        },
      },
      cep: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "CEP deve ter no máximo 255 caracteres",
          },
        },
      },
      telefone: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "Telefone deve ter no máximo 255 caracteres",
          },
        },
      },
      cnpj_cpf: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "CNPJ/CPF deve ter no máximo 255 caracteres",
          },
        },
      },
      atividade: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "Atividade deve ter no máximo 255 caracteres",
          },
        },
      },
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
