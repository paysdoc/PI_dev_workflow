# ADW BDD Scenario Configuration

## Scenario Directory
features/

## Run Scenarios by Tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"

## Run Regression Scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --profile regression

<!-- Regression scenarios carry no tags: the `regression` profile in cucumber.json selects
     them by path. A path on the command line does not do this, because cucumber-js adds it
     to the profile's `paths` instead of replacing them. -->

<!-- The three optional sections below activate the regression-suite contract for repos that
     opt in. Target repos that omit them keep free-form behaviour: every scenario counts as
     per-issue and the vocabulary rule does not apply. When they are present, write-scenarios
     routes new scenarios to Per-Issue Scenario Directory, never promotes, and lets an edited
     regression scenario use only phrases registered in the Vocabulary Registry. -->

## Per-Issue Scenario Directory
<!-- Consumed by write-scenarios. Absent → falls back to ## Scenario Directory. -->
features/per-issue/

## Regression Scenario Directory
<!-- Consumed by write-scenarios. Regression files carry no tags and are never auto-promoted. -->
features/regression/

## Vocabulary Registry
<!-- Consumed by write-scenarios. Edited regression scenarios may use only registered phrases. -->
features/regression/vocabulary.md

## BDD Framework
cucumber-js

## Step Def Directory
features/steps

## DSL Directory
features/support/dsl/

## Driver Directory
features/support/drivers/
