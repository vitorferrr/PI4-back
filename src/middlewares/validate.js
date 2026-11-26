const validate = (schema) => async (req, res, next) => {
  try {
    const validated = await schema.parseAsync({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (validated.body !== undefined) {
      req.body = validated.body;
    }
    if (validated.params !== undefined) {
      req.params = validated.params;
    }
    if (validated.query !== undefined) {
      Object.defineProperty(req, "query", {
        value: validated.query,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

export default validate;
