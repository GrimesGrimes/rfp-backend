
import { Router } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";

const router = Router();

const Register = z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().optional() });
router.post("/register", async (req, res) => {
  const body = Register.safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error);

  const { email, password, name } = body.data;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: "email in use" });

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, hash, name } });
  return res.json({ id: user.id });
});

const Login = z.object({ email: z.string().email(), password: z.string().min(6) });
router.post("/login", async (req, res) => {
  const body = Login.safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error);

  const { email, password } = body.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "bad credentials" });

  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) return res.status(401).json({ error: "bad credentials" });

  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  return res.json({ token });
});

export default router;
