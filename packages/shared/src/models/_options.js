// Shared schema options: API responses expose `id` instead of `_id`/`__v`.
export const jsonOptions = {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  },
};

export const baseOptions = { timestamps: true, toJSON: jsonOptions, toObject: jsonOptions };
