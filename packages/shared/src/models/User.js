import mongoose from 'mongoose';
import { baseOptions, jsonOptions } from './_options.js';

const userJsonOptions = {
  ...jsonOptions,
  transform(_doc, ret) {
    delete ret._id;
    delete ret.passwordHash;
    return ret;
  },
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false so the hash is never loaded unless explicitly asked for (login only).
    passwordHash: { type: String, required: true, select: false },
  },
  { ...baseOptions, toJSON: userJsonOptions, toObject: userJsonOptions },
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
