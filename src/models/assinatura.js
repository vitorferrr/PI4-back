const getAssinaturaModel = (sequelize, { DataTypes, Op }) => {
  const Assinatura = sequelize.define(
    "assinatura",
    {
      documento_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "documentos",
          key: "id",
        },
      },
      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "usuarios",
          key: "id",
        },
      },
      assinante_nome: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      assinante_tipo: {
        type: DataTypes.ENUM("fiscalizador", "denunciado", "testemunha"),
        allowNull: false,
      },
      assinante_documento: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      assinante_email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },
      recusou: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      imagem_assinatura_url: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: {
          notEmpty: true,
        },
      },
      data_assinatura: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "assinaturas",
      underscored: true,
      validate: {
        imagemOuRecusa() {
          if (Boolean(this.recusou) === Boolean(this.imagem_assinatura_url)) {
            throw new Error("Informe a imagem da assinatura ou a recusa, nunca as duas");
          }
        },
      },
      indexes: [
        {
          name: "assinaturas_documento_fiscal",
          unique: true,
          fields: ["documento_id", "usuario_id"],
          where: { usuario_id: { [Op.ne]: null } },
        },
        {
          name: "assinaturas_documento_responsavel",
          unique: true,
          fields: ["documento_id"],
          where: { assinante_tipo: "denunciado" },
        },
      ],
    }
  );

  Assinatura.associate = (models) => {
    Assinatura.belongsTo(models.Documento, {
      foreignKey: "documento_id",
      as: "documento",
      onDelete: "CASCADE",
    });

    Assinatura.belongsTo(models.Usuario, {
      foreignKey: "usuario_id",
      as: "usuario",
    });
  };

  return Assinatura;
};

export default getAssinaturaModel;
