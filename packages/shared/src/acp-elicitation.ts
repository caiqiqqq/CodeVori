import { z } from "zod";

const choiceSchema = z
  .object({
    value: z.string().max(4096),
    label: z.string().max(4096),
    description: z.string().max(8192).optional(),
  })
  .strict();
export const acpElicitationFieldSchema = z
  .object({
    key: z.string().min(1).max(256),
    title: z.string().max(4096),
    description: z.string().max(8192).optional(),
    type: z.enum(["string", "number", "integer", "boolean", "array"]),
    required: z.boolean(),
    sensitive: z.boolean(),
    choices: z.array(choiceSchema).max(128),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().max(1024).optional(),
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AcpElicitationField = z.infer<typeof acpElicitationFieldSchema>;
export const acpElicitationSchema = z
  .object({
    requestId: z.string().min(1).max(256),
    message: z.string().max(8192),
    fields: z.array(acpElicitationFieldSchema).max(32),
  })
  .strict();
export type AcpElicitation = z.infer<typeof acpElicitationSchema>;
export const acpElicitationContentSchema = z.record(
  z.string().max(256),
  z.union([z.string().max(32768), z.number(), z.boolean(), z.array(z.string().max(4096)).max(128)]),
);
export const acpElicitationResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), content: acpElicitationContentSchema }).strict(),
  z.object({ action: z.literal("decline") }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);
export type AcpElicitationResponse = z.infer<typeof acpElicitationResponseSchema>;

const enumOption = z.object({
  const: z.string().max(4096),
  title: z.string().max(4096),
  description: z.string().max(8192).nullish(),
});
const rawProperty = z.object({
  type: acpElicitationFieldSchema.shape.type,
  title: z.string().max(4096).nullish(),
  description: z.string().max(8192).nullish(),
  enum: z.array(z.string().max(4096)).max(128).nullish(),
  oneOf: z.array(enumOption).max(128).nullish(),
  items: z
    .object({
      type: z.literal("string").optional(),
      enum: z.array(z.string().max(4096)).max(128).optional(),
      anyOf: z.array(enumOption).max(128).optional(),
    })
    .nullish(),
  minLength: acpElicitationFieldSchema.shape.minLength.nullable(),
  maxLength: acpElicitationFieldSchema.shape.maxLength.nullable(),
  pattern: acpElicitationFieldSchema.shape.pattern.nullable(),
  format: acpElicitationFieldSchema.shape.format.nullable(),
  minimum: acpElicitationFieldSchema.shape.minimum.nullable(),
  maximum: acpElicitationFieldSchema.shape.maximum.nullable(),
  minItems: acpElicitationFieldSchema.shape.minItems.nullable(),
  maxItems: acpElicitationFieldSchema.shape.maxItems.nullable(),
  _meta: z
    .object({ codex: z.object({ isSecret: z.boolean().optional() }).passthrough().nullish() })
    .passthrough()
    .nullish(),
});

/** ACP schema is projected once at the adapter boundary; unsupported forms are never partly accepted. */
export function parseAcpElicitationForm(input: unknown): AcpElicitationField[] {
  const schema = z
    .object({
      type: z.literal("object").optional(),
      properties: z.record(z.string().min(1).max(256), rawProperty).default({}),
      required: z.array(z.string()).max(32).nullish(),
    })
    .parse(input);
  const required = new Set(schema.required ?? []);
  if ([...required].some((key) => !Object.hasOwn(schema.properties, key)))
    throw new Error("ACP form required field is missing");
  const fields = Object.entries(schema.properties).map(([key, property]) => {
    const source = property.type === "array" ? property.items : property;
    const titled = property.type === "array" ? property.items?.anyOf : property.oneOf;
    const choices =
      titled?.map((option) => ({
        value: option.const,
        label: option.title,
        ...(option.description ? { description: option.description } : {}),
      })) ??
      source?.enum?.map((value) => ({ value, label: value })) ??
      [];
    if (property.type === "array" && (!property.items || !choices.length))
      throw new Error("ACP multi-select requires enum choices");
    if (property.type === "string" && (property.enum || property.oneOf) && !choices.length)
      throw new Error("ACP single-select requires non-empty choices");
    if (new Set(choices.map((choice) => choice.value)).size !== choices.length)
      throw new Error("ACP form choices must be unique");
    if (property.pattern) new RegExp(property.pattern, "u");
    return acpElicitationFieldSchema.parse({
      key,
      title: property.title ?? key,
      type: property.type,
      required: required.has(key),
      sensitive: property._meta?.codex?.isSecret === true,
      choices,
      ...Object.fromEntries(
        [
          "description",
          "minLength",
          "maxLength",
          "pattern",
          "format",
          "minimum",
          "maximum",
          "minItems",
          "maxItems",
        ].flatMap((name) => {
          const value = property[name as keyof typeof property];
          return value == null ? [] : [[name, value]];
        }),
      ),
    });
  });
  return z.array(acpElicitationFieldSchema).max(32).parse(fields);
}

export function validateAcpElicitationContent(
  fields: readonly AcpElicitationField[],
  input: unknown,
): boolean {
  const parsed = acpElicitationContentSchema.safeParse(input);
  if (!parsed.success) return false;
  const content = parsed.data;
  if (Object.keys(content).some((key) => !fields.some((field) => field.key === key))) return false;
  return fields.every((field) => {
    const value = Object.hasOwn(content, field.key) ? content[field.key] : undefined;
    if (value === undefined) return !field.required;
    if (field.type === "boolean") return typeof value === "boolean";
    if (field.type === "number" || field.type === "integer")
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.type !== "integer" || Number.isInteger(value)) &&
        (field.minimum === undefined || value >= field.minimum) &&
        (field.maximum === undefined || value <= field.maximum)
      );
    if (field.type === "array")
      return (
        Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((item) => field.choices.some((choice) => choice.value === item)) &&
        (field.minItems === undefined || value.length >= field.minItems) &&
        (field.maxItems === undefined || value.length <= field.maxItems)
      );
    if (typeof value !== "string") return false;
    if (field.required && !value.length) return false;
    if (field.choices.length && !field.choices.some((choice) => choice.value === value))
      return false;
    if (field.minLength !== undefined && [...value].length < field.minLength) return false;
    if (field.maxLength !== undefined && [...value].length > field.maxLength) return false;
    if (field.pattern && !new RegExp(field.pattern, "u").test(value)) return false;
    const formats = {
      email: z.email(),
      uri: z.url(),
      date: z.iso.date(),
      "date-time": z.iso.datetime({ offset: true }),
    };
    return !field.format || formats[field.format].safeParse(value).success;
  });
}
