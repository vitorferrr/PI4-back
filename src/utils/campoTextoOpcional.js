const TAMANHO_MAXIMO = 255;

const campoTextoOpcional = (DataTypes, nome, rotulo) => ({
  [nome]: {
    type: DataTypes.STRING,
    allowNull: true,
    set(valor) {
      this.setDataValue(nome, typeof valor === "string" ? valor.trim() || null : valor);
    },
    validate: {
      len: {
        args: [0, TAMANHO_MAXIMO],
        msg: `${rotulo} deve ter no máximo ${TAMANHO_MAXIMO} caracteres`,
      },
    },
  },
});

export default campoTextoOpcional;
