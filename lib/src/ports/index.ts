/**
 * Port interfaces — the IO contracts that separate domain/application
 * code from concrete infrastructure adapters.
 *
 * Feature layers (install, registry-config, primitive-index) import
 * only from this barrel; concrete adapters live in `infra/` and are
 * never imported by feature code.
 * @module ports
 */
export type {
  FileSystem,
} from './filesystem';

export type {
  Clock,
  TestClock,
} from './clock';

export type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  TokenProvider,
} from './http';
