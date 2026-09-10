import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  // Loopback by default: in production a reverse proxy fronts this and holds
  // the only credentials, so the API must not be reachable directly.
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen(port, host);
  console.log(`Backend listening on http://${host}:${port}`);
}

bootstrap();
