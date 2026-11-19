# Changelog

## [2.1.0](https://github.com/MasRama/macroma-pm-v2/compare/v2.0.1...v2.1.0) (2026-11-19)


### Features

* **api:** read-only public API v1 ([#40](https://github.com/MasRama/macroma-pm-v2/issues/40)) ([623bc79](https://github.com/MasRama/macroma-pm-v2/commit/623bc79dfdab3ee55c901229bedfa9a27bb66bb1))
* **api:** write endpoints in public API v1 ([#42](https://github.com/MasRama/macroma-pm-v2/issues/42)) ([fe53a8e](https://github.com/MasRama/macroma-pm-v2/commit/fe53a8e14ee00146734def802969c14078f960ca))
* **app:** API docs page ([#44](https://github.com/MasRama/macroma-pm-v2/issues/44)) ([6f58193](https://github.com/MasRama/macroma-pm-v2/commit/6f5819305c16efed2190be1ae9445d67395ff736))
* **auth:** personal access tokens ([#36](https://github.com/MasRama/macroma-pm-v2/issues/36)) ([f73c77e](https://github.com/MasRama/macroma-pm-v2/commit/f73c77ec8fb51da403b0326930149646afa532ce))
* manage API tokens from a Token API settings page ([#38](https://github.com/MasRama/macroma-pm-v2/issues/38)) ([c246e89](https://github.com/MasRama/macroma-pm-v2/commit/c246e89b55685f6a56c16f0708925c034d2b40e6))


### Bug Fixes

* **auth:** harden personal access tokens ([#39](https://github.com/MasRama/macroma-pm-v2/issues/39)) ([ea19dea](https://github.com/MasRama/macroma-pm-v2/commit/ea19dea01427c578d1506839323844bd1816a9cc))
* **projects:** bump task updated_at on comments and attachments ([#43](https://github.com/MasRama/macroma-pm-v2/issues/43)) ([5225176](https://github.com/MasRama/macroma-pm-v2/commit/5225176344266790f0e12022125054fef4e22a7d))
* **realtime:** report resumed after a stream ended ([#45](https://github.com/MasRama/macroma-pm-v2/issues/45)) ([e028d53](https://github.com/MasRama/macroma-pm-v2/commit/e028d53e6c3fd4eb124771b87a45ccf37735205d))
* **tokens:** show the password field when the server asks for one ([#46](https://github.com/MasRama/macroma-pm-v2/issues/46)) ([350b6b6](https://github.com/MasRama/macroma-pm-v2/commit/350b6b690ecc61fc1494a642a0efdd22c6bf704e))

## [2.0.1](https://github.com/MasRama/macroma-pm-v2/compare/v2.0.0...v2.0.1) (2026-11-18)


### Bug Fixes

* list only the selected workspace's projects and fit drawers to phones ([#34](https://github.com/MasRama/macroma-pm-v2/issues/34)) ([16521ee](https://github.com/MasRama/macroma-pm-v2/commit/16521eeac5645f9a6eb592c2fa02a2fe0b66013a))

## 2.0.0 (2026-11-17)


### Features

* add Macroma V2 design tokens, app shell and screen layouts ([#5](https://github.com/MasRama/macroma-pm-v2/issues/5)) ([e6ca145](https://github.com/MasRama/macroma-pm-v2/commit/e6ca14550d12f7b9ecab999a8d1e5f889e4224be))
* **auth:** add phone, verified flag, Google sign-in and password reset by email ([#4](https://github.com/MasRama/macroma-pm-v2/issues/4)) ([ae05013](https://github.com/MasRama/macroma-pm-v2/commit/ae0501334450ba30b1606375574cfdb1d7f437fd))
* connect sign-in, profile and user admin screens to the API ([#16](https://github.com/MasRama/macroma-pm-v2/issues/16)) ([9e2fd57](https://github.com/MasRama/macroma-pm-v2/commit/9e2fd573cad42c50b3e34b301d5e60492fe51a83))
* connect the board, task detail and task modals to the API ([#22](https://github.com/MasRama/macroma-pm-v2/issues/22)) ([72d174d](https://github.com/MasRama/macroma-pm-v2/commit/72d174def3232a722fa2b56ae3b08e340b9d9c2f))
* connect the Rilis tab to the releases API ([#33](https://github.com/MasRama/macroma-pm-v2/issues/33)) ([5519b3a](https://github.com/MasRama/macroma-pm-v2/commit/5519b3aa30dc8933f3d7c49ae2b7931bb38146f3))
* connect workspaces, members, invitations and chat to the API ([#19](https://github.com/MasRama/macroma-pm-v2/issues/19)) ([ddc2c42](https://github.com/MasRama/macroma-pm-v2/commit/ddc2c4283b166b44f782bfcec7eae5f908edf138))
* **notifications:** add per-account notifications with read state ([#6](https://github.com/MasRama/macroma-pm-v2/issues/6)) ([4b4eb52](https://github.com/MasRama/macroma-pm-v2/commit/4b4eb52c0e8a9c76f96730ca2b952a97729889af))
* **projects:** add projects, members, batches and kanban tasks with version log ([#10](https://github.com/MasRama/macroma-pm-v2/issues/10)) ([fd8693d](https://github.com/MasRama/macroma-pm-v2/commit/fd8693d5e21da6874cd71ca66829e8df937f4781))
* **projects:** add task comments and image attachments ([#12](https://github.com/MasRama/macroma-pm-v2/issues/12)) ([0304ec9](https://github.com/MasRama/macroma-pm-v2/commit/0304ec910cc37ca48bd2c20cfbc299fb00daa4d3))
* **projects:** add the dashboard ([#15](https://github.com/MasRama/macroma-pm-v2/issues/15)) ([54ac34d](https://github.com/MasRama/macroma-pm-v2/commit/54ac34df042f57c5f5b57963889e2fb66692b664))
* **projects:** add the releases view with changelog, stats and contributors ([#13](https://github.com/MasRama/macroma-pm-v2/issues/13)) ([d2dcecf](https://github.com/MasRama/macroma-pm-v2/commit/d2dcecfe3b006d40c90308fe61d3bd239e046a46))
* **projects:** connect task comments and images to the API ([#24](https://github.com/MasRama/macroma-pm-v2/issues/24)) ([fa27491](https://github.com/MasRama/macroma-pm-v2/commit/fa274911053cdc2593d1a1a428223e33ff7a4e3f))
* **projects:** count projects with active tasks on the dashboard ([#31](https://github.com/MasRama/macroma-pm-v2/issues/31)) ([aa345ca](https://github.com/MasRama/macroma-pm-v2/commit/aa345cafc29dfc6603c2b725cdce815ec7390287))
* **projects:** name the task and batch version in activity rows ([#27](https://github.com/MasRama/macroma-pm-v2/issues/27)) ([c5f6288](https://github.com/MasRama/macroma-pm-v2/commit/c5f6288d3fac2945358e6365069e60024bb958f3))
* **projects:** name the task and batch version in dashboard activity lines ([#23](https://github.com/MasRama/macroma-pm-v2/issues/23)) ([e5f1cda](https://github.com/MasRama/macroma-pm-v2/commit/e5f1cda48c05c5ce378ab4a7f148ade29999e063))
* **projects:** notify the assignee and creator when a task moves ([#26](https://github.com/MasRama/macroma-pm-v2/issues/26)) ([24ac766](https://github.com/MasRama/macroma-pm-v2/commit/24ac766a888fe1091580a876053ccd4f8d83ceed))
* show live notifications in the bell menu ([#17](https://github.com/MasRama/macroma-pm-v2/issues/17)) ([d92195d](https://github.com/MasRama/macroma-pm-v2/commit/d92195dce93b2301108b1499cfc89c3bb1ff58c8))
* show task moves in the bell menu ([#29](https://github.com/MasRama/macroma-pm-v2/issues/29)) ([2f6a9fd](https://github.com/MasRama/macroma-pm-v2/commit/2f6a9fdec31d040ac85b3648f290216784b5fb97))
* **v1-import:** import a V1 database ([#20](https://github.com/MasRama/macroma-pm-v2/issues/20)) ([be2f31d](https://github.com/MasRama/macroma-pm-v2/commit/be2f31dccdc1996425a3f56c3e1170d9b0551bb5))
* **workspaces:** add workspaces, members, invitations and chat ([#7](https://github.com/MasRama/macroma-pm-v2/issues/7)) ([ea79597](https://github.com/MasRama/macroma-pm-v2/commit/ea79597408cf599e6e25a385b538d47ab8d42169))


### Bug Fixes

* keep Task baru disabled until a batch exists and label the Rilis bump menu from the latest batch ([#32](https://github.com/MasRama/macroma-pm-v2/issues/32)) ([1372cde](https://github.com/MasRama/macroma-pm-v2/commit/1372cde8d00f969a065ec775e053a3fd1beef7b4))
* **projects:** count dashboard days in the app timezone ([#18](https://github.com/MasRama/macroma-pm-v2/issues/18)) ([2a55d61](https://github.com/MasRama/macroma-pm-v2/commit/2a55d614c9952efcaaf699a3ab4a0111d12538cd))
* **projects:** list only batches that were released and close them at the next activation ([#14](https://github.com/MasRama/macroma-pm-v2/issues/14)) ([b2e3610](https://github.com/MasRama/macroma-pm-v2/commit/b2e361074320b50b719b3fe9a4bae578bdb404be))
* **projects:** move batch-less tasks into a project's first activated batch ([#30](https://github.com/MasRama/macroma-pm-v2/issues/30)) ([175beca](https://github.com/MasRama/macroma-pm-v2/commit/175beca621a8063f4d5e92a9fe2e5c0d5136f1fd))
* **projects:** version tasks from their own batch and refresh boards when access is lost ([#11](https://github.com/MasRama/macroma-pm-v2/issues/11)) ([03e8489](https://github.com/MasRama/macroma-pm-v2/commit/03e84897dde1e0dc05b6f6a5b76cd607016cbc13))
* reach user actions on phones and keep the admin edit form live ([#25](https://github.com/MasRama/macroma-pm-v2/issues/25)) ([555fc6c](https://github.com/MasRama/macroma-pm-v2/commit/555fc6c4db427ead2fa1d0f641344a2641788bde))

## 1.x

Macroma V1 is a separate codebase. Its history is in
[MasRama/macroma-pm](https://github.com/MasRama/macroma-pm).
