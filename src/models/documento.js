const getDocumentoModel = (sequelize, { DataTypes }) => {
  const Documento = sequelize.define(
    "documento",
    {
      visita_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "visitas",
          key: "id",
        },
      },
      url_arquivo_pdf: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: {
          notEmpty: true,
        },
      },
      data_geracao: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      enviado_email: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "documentos",
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ["visita_id"],
        },
      ],
    }
  );

  Documento.associate = (models) => {
    Documento.belongsTo(models.Visita, {
      foreignKey: "visita_id",
      as: "visita",
      onDelete: "CASCADE",
    });

    Documento.hasMany(models.Assinatura, {
      foreignKey: "documento_id",
      as: "assinaturas",
      onDelete: "CASCADE",
    });
  };

  return Documento;
};

export default getDocumentoModel;
